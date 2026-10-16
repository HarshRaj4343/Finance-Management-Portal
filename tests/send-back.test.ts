import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { billForm } from "./fixtures";
import { returnTargets, sentBackHere } from "@/lib/bill-review";

const mocks = vi.hoisted(() => ({
  actor: { code: "TEST-F", name: "Finance", email: null, department: "A", role: "Finance Admin", provisioned: true },
  queryOne: vi.fn(), notify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/session", () => ({
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  requireActor: async () => mocks.actor,
  requireApprover: async () => {
    if (!["Student Purchase", "Audit", "Finance Admin"].includes(mocks.actor.role)) throw Object.assign(new Error("Only an approving desk can act on a bill."), { status: 403 });
    return mocks.actor;
  },
}));
vi.mock("@/server/notify", () => ({ notifyApplicant: mocks.notify }));
vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return { ...actual, queryOne: mocks.queryOne };
});
import { POST as action } from "@/app/api/bills/[id]/action/route";
import { PATCH as deskCorrection } from "@/app/api/bills/[id]/desk-correction/route";

const ID = "00000000-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (path: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const call = (body: unknown) => action(req(`/api/bills/${ID}/action`, body), ctx);
const actionCall = () => mocks.queryOne.mock.calls.find(([sql]) => String(sql).includes("fn_bill_action"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.role = "Finance Admin"; mocks.actor.code = "TEST-F";
  mocks.queryOne.mockImplementation(async (sql: string) =>
    sql.includes("select status") ? { status: "Finance Admin" } : sql.includes("employee_id from") ? { employee_id: "TEST-U" } : { bill: { status: "Audit" } });
});

describe("sending a bill back to an earlier desk", () => {
  it("needs a known destination desk before touching the database", async () => {
    for (const extra of [undefined, {}, { return_to: "Dean" }, { return_to: "" }]) {
      expect((await call({ action: "Returned", extra, expected_revision: 2 })).status).toBe(400);
    }
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("takes an optional remark, forwards only the destination, and emails nobody", async () => {
    const res = await call({ action: "Returned", extra: { return_to: "Audit", has_bank_guarantee: true }, expected_revision: 2 });
    expect(res.status).toBe(200);
    const params = actionCall()![1];
    expect(params.slice(3, 6)).toEqual(["Finance Admin", "Returned", null]);
    expect(JSON.parse(params[6])).toEqual({ return_to: "Audit", expected_revision: 2 });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("still requires a remark to hold or reject, and still emails the applicant", async () => {
    expect((await call({ action: "Rejected", expected_revision: 2 })).status).toBe(400);
    expect((await call({ action: "Hold", remark: " ", expected_revision: 2 })).status).toBe(400);
    expect((await call({ action: "Rejected", remark: "Duplicate invoice", expected_revision: 2 })).status).toBe(200);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ outcome: "Rejected" }));
  });

  it("is refused for anyone who does not sit at an approval desk", async () => {
    mocks.actor.role = "Bill Employee";
    expect((await call({ action: "Returned", extra: { return_to: "Audit" }, expected_revision: 2 })).status).toBe(403);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
});

describe("a desk correcting a bill sent back to it", () => {
  const patch = (body: unknown) => deskCorrection(req(`/api/bills/${ID}/desk-correction`, body, "PATCH"), ctx);

  it("validates the whole form and sends the reviewed revision to fn_desk_amend_bill", async () => {
    mocks.actor.role = "Audit"; mocks.actor.code = "TEST-A";
    const res = await patch({ form_data: billForm("TEST-U", 2500), expected_revision: 4 });
    expect(res.status).toBe(200);
    const call = mocks.queryOne.mock.calls.find(([sql]) => String(sql).includes("fn_desk_amend_bill"))!;
    const payload = JSON.parse(call[1][1]);
    expect(payload).toMatchObject({ employee_id: "TEST-U", expected_revision: 4, po_value: 2500 });
    expect(JSON.parse(call[1][2])).toEqual({ code: "TEST-A", name: "Finance", role: "Audit" });
  });

  it("refuses non-desk roles, broken forms and a changed applicant", async () => {
    mocks.actor.role = "Bill Employee";
    expect((await patch({ form_data: billForm(), expected_revision: 1 })).status).toBe(403);
    mocks.actor.role = "Audit";
    const bad = billForm(); bad.poValue = "1";
    expect((await patch({ form_data: bad, expected_revision: 1 })).status).toBe(400);
    expect((await patch({ form_data: billForm("TEST-X"), expected_revision: 1 })).status).toBe(400);
    expect(mocks.queryOne.mock.calls.some(([sql]) => String(sql).includes("fn_desk_amend_bill"))).toBe(false);
  });
});

describe("where a bill may be sent back to (mirrors fn_bill_return_engine)", () => {
  const at = (status: string, snp: string | null, audit: string | null) => ({ status, snp, audit, finance_admin: "Pending" }) as Parameters<typeof returnTargets>[0];
  it("offers only earlier desks that approved the bill", () => {
    expect(returnTargets(at("Finance Admin", "Approved", "Approved"))).toEqual(["Student Purchase", "Audit"]);
    expect(returnTargets(at("Finance Admin", null, null))).toEqual([]);
    expect(returnTargets(at("Finance Admin", "Approved", null))).toEqual(["Student Purchase"]);
    expect(returnTargets(at("Audit", "Approved", "Pending"))).toEqual(["Student Purchase"]);
    expect(returnTargets(at("Audit", null, "Pending"))).toEqual([]);
    expect(returnTargets(at("Student Purchase", "Pending", null))).toEqual([]);
    expect(returnTargets(at("Accepted", "Approved", "Approved"))).toEqual([]);
  });
  it("marks a bill sent back only while it sits at a desk", () => {
    expect(sentBackHere({ status: "Audit", returned_from: "Finance Admin" })).toBe(true);
    expect(sentBackHere({ status: "Audit", returned_from: null })).toBe(false);
    expect(sentBackHere({ status: "Rejected", returned_from: "Finance Admin" })).toBe(false);
  });
});
