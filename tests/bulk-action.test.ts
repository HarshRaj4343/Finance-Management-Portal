import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  actor: { code: "TEST-F", name: "Finance", email: null, department: null, role: "Finance Admin", provisioned: true },
  query: vi.fn(), decide: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/session", () => ({ requireApprover: async () => mocks.actor }));
vi.mock("@/server/decide", () => ({ decideBill: mocks.decide }));
vi.mock("@/server/db", () => ({ query: mocks.query }));
import { POST } from "@/app/api/bills/bulk-action/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const send = async (bills: unknown) => {
  const res = await POST(new NextRequest("http://localhost/api/bills/bulk-action", {
    method: "POST", body: JSON.stringify({ bills }), headers: { "content-type": "application/json" },
  }));
  return { status: res.status, body: await res.json() };
};
const rows = (amounts: number[]) => amounts.map((po_value, i) => ({ id: id(i + 1), bill_number: `TEST/${i + 1}`, po_value }));
const ask = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1), expected_revision: 1 }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.role = "Finance Admin";
  mocks.decide.mockImplementation(async (_actor, billId) => ({ id: billId, status: "Accepted" }));
});

describe("bulk approval limits and outcomes", () => {
  it("approves each bill on its own, at most 75 and ₹25 lakh per batch", async () => {
    mocks.query.mockResolvedValue(rows(Array(75).fill(1000)));
    const ok = await send(ask(75));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ approved: 75, failed: 0, total: 75000 });
    expect(mocks.decide).toHaveBeenCalledTimes(75);
    expect(mocks.decide).toHaveBeenCalledWith(mocks.actor, id(1), "Approved", null, {}, 1);

    mocks.decide.mockClear();
    expect((await send(ask(76))).status).toBe(400);
    mocks.query.mockResolvedValue(rows([500000, 500000, 500000, 500000, 500000, 1]));
    const over = await send(ask(6));
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/at most ₹25,00,000/);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("refuses bills above ₹5 lakh one by one, never deciding them", async () => {
    mocks.query.mockResolvedValue(rows([500000, 500000.01, 200]));
    const { body } = await send(ask(3));
    expect(body).toMatchObject({ approved: 2, failed: 1 });
    expect(body.outcomes.find((o: { id: string }) => o.id === id(2))).toMatchObject({ ok: false, error: expect.stringMatching(/5,00,000.*on its own/) });
    expect(mocks.decide).not.toHaveBeenCalledWith(expect.anything(), id(2), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("reports each refusal without stopping the others", async () => {
    mocks.query.mockResolvedValue(rows([100, 200, 300]));
    mocks.decide.mockImplementation(async (_a, billId) => {
      if (billId === id(2)) throw Object.assign(new Error("The bill has changed. Reload before deciding it."), { code: "40001" });
      return { id: billId };
    });
    const { body } = await send(ask(3));
    expect(body).toMatchObject({ approved: 2, failed: 1, total: 400 });
    expect(body.outcomes[1]).toMatchObject({ ok: false, error: "The bill has changed. Reload before deciding it." });
  });

  it("approves Store and Purchase bills without a bank guarantee, and rejects malformed batches", async () => {
    mocks.actor.role = "Student Purchase";
    mocks.query.mockResolvedValue(rows([100]));
    await send(ask(1));
    expect(mocks.decide).toHaveBeenCalledWith(mocks.actor, id(1), "Approved", null, { has_bank_guarantee: false }, 1);
    expect((await send([])).status).toBe(400);
    expect((await send([{ id: id(1), expected_revision: 1 }, { id: id(1), expected_revision: 1 }])).status).toBe(400);
    expect((await send([{ id: "not-a-uuid", expected_revision: 1 }])).status).toBe(400);
    expect((await send([{ id: id(1) }])).status).toBe(400);
  });
});
