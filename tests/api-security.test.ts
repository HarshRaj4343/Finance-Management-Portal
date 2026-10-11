import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { billForm } from "./fixtures";
const mocks = vi.hoisted(() => ({
  actor: { code: "TEST-C", name: "Clerk", email: null, department: "A", role: "Bill Employee", provisioned: true },
  query: vi.fn(), queryOne: vi.fn(), actorQueryOne: vi.fn(), findEmployee: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/session", () => ({
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  requireActor: async () => mocks.actor,
  requireRole: async (...roles: string[]) => { if (!roles.includes(mocks.actor.role)) throw Object.assign(new Error("Denied"), { status: 403 }); return mocks.actor; },
}));
vi.mock("@/server/employee", () => ({ findEmployee: mocks.findEmployee }));
vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return { ...actual, query: mocks.query, queryOne: mocks.queryOne, actorQueryOne: mocks.actorQueryOne };
});
import { POST as submit } from "@/app/api/bills/route";
import { GET as register } from "@/app/api/register/route";
import { POST as addEmployee } from "@/app/api/admin/employees/route";
import { PATCH as updateEmployee } from "@/app/api/admin/employees/[code]/route";
import { PATCH as pda } from "@/app/api/admin/pda/route";
const req = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, body ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } } : undefined);
beforeEach(() => { vi.clearAllMocks(); mocks.actor.role = "Bill Employee"; mocks.actor.code = "TEST-C"; mocks.actor.department = "A"; mocks.findEmployee.mockResolvedValue({ employee_code: "TEST-U", employee_name: "Applicant", department: "A", is_active: true }); });
describe("API authority and financial boundaries", () => {
  it("rejects cross-department filing before the database write", async () => {
    mocks.findEmployee.mockResolvedValue({ employee_code: "TEST-U", department: "B", is_active: true });
    expect((await submit(req("/api/bills", { form_data: billForm() }))).status).toBe(403);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
  it("rejects staff filing privileges even if they can read every bill", async () => {
    mocks.actor.role = "Audit";
    expect((await submit(req("/api/bills", { form_data: billForm() }))).status).toBe(403);
  });
  it("ignores a forged flattened amount and sends the derived item total", async () => {
    mocks.queryOne.mockResolvedValue({ bill: {} });
    expect((await submit(req("/api/bills", { form_data: billForm(), po_value: 1, submission_key: "key" }))).status).toBe(201);
    expect(JSON.parse(mocks.queryOne.mock.calls[0][1][0]).po_value).toBe(1000);
  });
  it("blocks allocations via employee creation and rejects NaN before any write", async () => {
    mocks.actor.role = "Finance Admin";
    const person = { employee_code: "U", employee_name: "User", email: "user@example.test", department: "A" };
    for (const allocated of [100, "NaN"]) expect((await addEmployee(req("/api/admin/employees", { ...person, allocated }))).status).toBe(400);
    expect(mocks.actorQueryOne).not.toHaveBeenCalled();
  });
  it("allows Finance Admin contact edits without requiring a role change", async () => {
    mocks.actor.role = "Finance Admin"; mocks.actorQueryOne.mockResolvedValue({ employee_code: "U" });
    expect((await updateEmployee(req("/api/admin/employees/U", { employee_name: "Updated" }), { params: Promise.resolve({ code: "U" }) })).status).toBe(200);
    expect((await updateEmployee(req("/api/admin/employees/U", { is_active: "false" }), { params: Promise.resolve({ code: "U" }) })).status).toBe(400);
  });
  it("uses the atomic delta function for top-ups with no pre-read", async () => {
    mocks.actor.role = "PDA Manager"; mocks.queryOne.mockResolvedValue({ account: {} });
    expect((await pda(req("/api/admin/pda", { employee_id: "U", top_up: 100 }))).status).toBe(200);
    expect(mocks.queryOne).toHaveBeenCalledExactlyOnceWith("select public.fn_top_up_pda($1, $2, $3) as account", ["U", 100, "TEST-C"]);
  });
  it("applies identical identity, search, date and year filters to rows and totals", async () => {
    mocks.actor.role = "User"; mocks.actor.code = "TEST-U";
    mocks.query.mockResolvedValue([]); mocks.queryOne.mockResolvedValue({ total: 0, totals: {} });
    expect((await register(req("/api/register?q=Secret&from=2026-01-01&fy=2025-26"))).status).toBe(200);
    const totalsCall = mocks.queryOne.mock.calls.find(([sql]) => sql.includes("jsonb_build_object"));
    const rowsCall = mocks.query.mock.calls.find(([sql]) => sql.includes("select *"));
    expect(totalsCall![0].split("where ")[1].trim()).toBe(rowsCall![0].split("where ")[1].split("order by")[0].trim());
    expect(totalsCall![1].slice(0, -1)).toEqual(rowsCall![1].slice(0, -2));
    expect(totalsCall![1][0]).toBe("TEST-U");
    expect(totalsCall![0]).not.toContain("fn_register_totals");
  });
});
