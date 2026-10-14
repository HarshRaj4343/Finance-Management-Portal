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
import { GET as fundHeads, POST as addFunding } from "@/app/api/fund-heads/route";
import { GET as movements } from "@/app/api/movements/route";
import { POST as addEmployee } from "@/app/api/admin/employees/route";
import { PATCH as updateEmployee } from "@/app/api/admin/employees/[code]/route";
import { PATCH as pda } from "@/app/api/admin/pda/route";
import { GET as funding } from "@/app/api/bills/funding/route";
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
  it("rejects a mismatch and reversed delivery date before any write", async () => {
    const f = billForm(); f.poValue = "1001";
    expect((await submit(req("/api/bills", { form_data: f }))).status).toBe(400);
    f.poValue = "1000"; f.deliveryDate = "2025-12-31";
    expect((await submit(req("/api/bills", { form_data: f }))).status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
  it("allows PDA as a validated source of fund", async () => {
    const f = billForm(); f.fund = "PDA";
    mocks.queryOne.mockResolvedValue({ bill: {} });
    expect((await submit(req("/api/bills", { form_data: f }))).status).toBe(201);
    expect(JSON.parse(mocks.queryOne.mock.calls[0][1][0]).source_of_fund).toBe("PDA");
  });
  it("restricts funding snapshots to the applicant or their authorised departmental filer", async () => {
    mocks.queryOne.mockResolvedValue({ employee_id: "TEST-U", balance: "1000" });
    expect((await funding(req("/api/bills/funding?employee=TEST-U"))).status).toBe(200);
    mocks.actor.department = "B";
    expect((await funding(req("/api/bills/funding?employee=TEST-U"))).status).toBe(403);
    mocks.actor.role = "User"; mocks.actor.code = "TEST-U";
    expect((await funding(req("/api/bills/funding?employee=TEST-U"))).status).toBe(200);
    mocks.actor.code = "TEST-X";
    expect((await funding(req("/api/bills/funding?employee=TEST-U"))).status).toBe(403);
    mocks.actor.role = "Audit";
    expect((await funding(req("/api/bills/funding?employee=TEST-U"))).status).toBe(403);
    expect((await funding(req("/api/bills/funding"))).status).toBe(400);
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
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
  it("opens the purchase register to the Dean only", async () => {
    for (const role of ["User", "Bill Employee", "Student Purchase", "Audit", "Finance Admin", "PDA Manager"]) {
      mocks.actor.role = role;
      expect((await register(req("/api/register"))).status).toBe(403);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("opens the inward / outward register to the Dean and the three approval desks only", async () => {
    for (const role of ["User", "Bill Employee", "PDA Manager"]) {
      mocks.actor.role = role;
      expect((await movements(req("/api/movements?register=Inward"))).status).toBe(403);
    }
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([]); mocks.queryOne.mockResolvedValue({ total: 0 });
    for (const role of ["Dean", "Finance Admin", "Audit", "Student Purchase"]) {
      mocks.actor.role = role;
      expect((await movements(req("/api/movements?register=Outward&desk=Audit"))).status).toBe(200);
    }
    expect((await movements(req("/api/movements?register=Sideways"))).status).toBe(400);
  });
  it("opens the OH-31 / OH-35 registers and allocations to the Dean only", async () => {
    for (const role of ["User", "Bill Employee", "Student Purchase", "Audit", "Finance Admin", "PDA Manager"]) {
      mocks.actor.role = role;
      expect((await fundHeads(req("/api/fund-heads?code=OH-31"))).status).toBe(403);
      expect((await addFunding(req("/api/fund-heads", { code: "OH-31", financial_year: "2026-27", amount: 100, reference: "R" }))).status).toBe(403);
    }
    expect(mocks.queryOne).not.toHaveBeenCalled();
    mocks.actor.role = "Dean"; mocks.actor.code = "TEST-D"; mocks.queryOne.mockResolvedValue({ head: {} });
    expect((await addFunding(req("/api/fund-heads", { code: "OH-40", financial_year: "2026-27", amount: 100, reference: "R" }))).status).toBe(400);
    expect((await addFunding(req("/api/fund-heads", { code: "OH-35", financial_year: "2026-27", amount: 100.123, reference: "R" }))).status).toBe(400);
    expect((await addFunding(req("/api/fund-heads", { code: "OH-35", financial_year: "2026-27", amount: 100, reference: "MoE/1" }))).status).toBe(201);
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining("fn_add_fund_allocation"), ["OH-35", "2026-27", 100, "MoE/1", null, "", "TEST-D"]);
  });
  it("exports the purchase register as CSV for the Dean only, with the same filters", async () => {
    mocks.actor.role = "Finance Admin";
    expect((await register(req("/api/register?format=csv"))).status).toBe(403);
    mocks.actor.role = "Dean";
    mocks.query.mockResolvedValue([{ serial_no: "SPS/2026-27/0001", amount: 39000, recorded_at: "2026-10-14T18:30:00Z", supplier_name: "=cmd" }]);
    const res = await register(req("/api/register?format=csv&fy=2026-27"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("purchase-register-2026-27.csv");
    const text = await res.text();
    expect(text).toContain("SPS/2026-27/0001");
    expect(text).toContain("39000.00");
    expect(text).toContain("'=cmd");
    expect(mocks.query.mock.calls[0][1]).toContain("2026-27");
  });
  it("applies identical search, date and year filters to rows and totals", async () => {
    mocks.actor.role = "Dean"; mocks.actor.code = "TEST-D";
    mocks.query.mockResolvedValue([]); mocks.queryOne.mockResolvedValue({ total: 0, totals: {} });
    expect((await register(req("/api/register?q=Secret&from=2026-01-01&fy=2025-26"))).status).toBe(200);
    const totalsCall = mocks.queryOne.mock.calls.find(([sql]) => sql.includes("jsonb_build_object"));
    const rowsCall = mocks.query.mock.calls.find(([sql]) => sql.includes("select *"));
    expect(totalsCall![0].split("where ")[1].trim()).toBe(rowsCall![0].split("where ")[1].split("order by")[0].trim());
    expect(totalsCall![1].slice(0, -1)).toEqual(rowsCall![1].slice(0, -2));
    expect(totalsCall![1][0]).toBe("2025-26");
    expect(totalsCall![0]).not.toContain("fn_register_totals");
  });
});
