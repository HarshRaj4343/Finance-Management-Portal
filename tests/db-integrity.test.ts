import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { toPayload, type FormState } from "@/app/apply-bill/bill-form/model";
import { billForm } from "./fixtures";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL financial integrity (isolated database only)", () => {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
  const filer = { code: "TEST-C", name: "Test clerk", role: "Bill Employee" };
  const department = "School of Computing & Electrical Engineering";
  const payload = (f: FormState) => ({ ...toPayload(f), form_data: f, invoice_no: f.billNo, invoice_date: f.billDate,
    date_of_delivery: f.deliveryDate, date_of_installation: null, submission_key: randomUUID() });
  const submit = async (p: Record<string, unknown> = payload(billForm()), actor = filer) => (await db.query("select public.fn_submit_bill($1,$2) as bill", [p, actor])).rows[0].bill;
  const decide = async (b: { id: string; revision: number }, role = "Finance Admin", action = "Approved", extra = {}) => {
    const code = role === "Finance Admin" ? "TEST-F" : role === "Audit" ? "TEST-A" : "TEST-S";
    return (await db.query("select public.fn_bill_action($1,$2,$2,$3,$4,$5,$6) as bill", [b.id, code, role, action, action === "Approved" ? null : "Test decision", { ...extra, expected_revision: b.revision }])).rows[0].bill;
  };
  beforeAll(async () => {
    const people = [["TEST-U","User"], ["TEST-C","Bill Employee"], ["TEST-E","Bill Editor"], ["TEST-F","Finance Admin"], ["TEST-A","Audit"], ["TEST-S","Student Purchase"], ["TEST-P","PDA Manager"], ["TEST-D","Dean"], ["TEST-X","User"], ["TEST-Z","User"]];
    for (const [code, role] of people) await db.query("insert into public.employees(employee_code,employee_name,email,department,employee_type) values($1,$1,$2,$3,$4)", [code, `${code}@example.test`, department, role]);
    for (const code of ["TEST-U", "TEST-X", "TEST-Z"]) await db.query("insert into public.pda_balances(employee_id,email,department,allocated,balance) values($1,$2,$3,1000000,1000000)", [code, `${code}@example.test`, department]);
  });
  afterAll(async () => { await db.end(); });

  it("reserves only once for retries and prevents duplicate invoices", async () => {
    const p = payload(billForm()); const b = await submit(p);
    expect((await submit(p)).id).toBe(b.id);
    await expect(submit({ ...p, submission_key: randomUUID() })).rejects.toMatchObject({ code: "23505" });
    await expect(submit({ ...p, po_value: 2 })).rejects.toThrow();
  });
  it("preserves a real pre-upgrade bill, PDA settlement, event history and register entry", async () => {
    const b = (await db.query("select * from public.bills where employee_id='LEGACY-U'")).rows[0];
    expect(b).toMatchObject({ status: "Accepted", form_data: null, created_by: "LEGACY-C", revision: 1 });
    expect(Number(b.po_value)).toBe(42);
    const p = (await db.query("select * from public.pda_balances where employee_id='LEGACY-U'")).rows[0];
    expect(Number(p.balance)).toBe(958); expect(Number(p.committed)).toBe(0); expect(Number(p.spent)).toBe(42);
    expect((await db.query("select count(*)::integer as n from public.purchase_register where bill_id=$1", [b.id])).rows[0].n).toBe(1);
    expect((await db.query("select count(*)::integer as n from public.bill_approvals where bill_id=$1", [b.id])).rows[0].n).toBe(4);
  });
  it("rejects malformed SQL payloads and nonfinite allocation", async () => {
    for (const fields of [{ qty: -2 }, { qty_issued: 99 }, { supplier_name: "" }, { po_value: "NaN" }, { source_of_fund: "INVALID" }]) await expect(submit({ ...payload(billForm()), ...fields })).rejects.toThrow();
    await expect(db.query("select public.fn_set_pda_allocation('TEST-U','NaN','TEST-P')")).rejects.toThrow();
    await expect(db.query("update public.pda_balances set allocated='NaN',balance='NaN' where employee_id='TEST-U'")).rejects.toThrow();
  });
  it("blocks edit until hold, then reroutes and invalidates every old approval", async () => {
    const p = payload(billForm("TEST-U", 40000)); let b = await submit(p);
    const amend = (body: object, version = b.revision) => db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...body, expected_revision: version }, filer]);
    await expect(amend(p)).rejects.toThrow(/hold/);
    b = await decide(b, "Finance Admin", "Hold");
    const next = payload({ ...p.form_data, category: "Major", lines: [{ ...p.form_data.lines[0], unitPrice: "90000" }] });
    b = (await amend(next)).rows[0].bill;
    expect(b).toMatchObject({ status: "Student Purchase", snp: "Pending", audit: null, finance_admin: null, po_value: 90000 });
    await expect(decide(b)).rejects.toThrow(/not Finance Admin/);
    b = await decide(b, "Student Purchase"); expect(b.status).toBe("Audit");
    b = await decide(b, "Audit"); b = await decide(b); expect(b.status).toBe("Accepted");
    const logs = (await db.query("select * from public.change_log where entity='bills' and entity_id=$1 and old_data->>'po_value'='40000.00'", [b.id])).rows;
    expect(logs.some((r) => Number(r.new_data.po_value) === 90000)).toBe(true);
    expect((await db.query("select count(*)::integer as n from public.purchase_register where bill_id=$1", [b.id])).rows[0].n).toBe(1);
  });
  it("rejects stale or missing review versions", async () => {
    const b = await submit(); await decide(b, "Finance Admin", "Hold");
    await expect(decide(b)).rejects.toMatchObject({ code: "40001" });
    await expect(db.query("select public.fn_bill_action($1,'TEST-F','F','Finance Admin','Approved')", [b.id])).rejects.toMatchObject({ code: "40001" });
  });
  it("does not grandfather a legacy bill that skipped a required approval desk", async () => {
    let b = await submit(payload(billForm("TEST-U", 60000, "Major")));
    b = (await db.query("update public.bills set status='Finance Admin',snp=null,audit=null,finance_admin='Pending' where id=$1 returning *", [b.id])).rows[0];
    await expect(decide(b)).rejects.toThrow(/approval is missing/);
    expect((await decide(b, "Finance Admin", "Hold")).finance_admin).toBe("Hold");
  });
  it("rejects overspending atomically and requires complete bank guarantees", async () => {
    const before = (await db.query("select count(*) as n from public.bills")).rows[0].n;
    await expect(submit(payload(billForm("TEST-U", 9999999)))).rejects.toThrow(/Insufficient/);
    expect((await db.query("select count(*) as n from public.bills")).rows[0].n).toBe(before);
    let b = await submit(payload(billForm("TEST-U", 50000, "Minor")));
    await expect(decide(b, "Student Purchase", "Approved", { has_bank_guarantee: true, bank_guarantee_amount: "NaN", bank_guarantee_details: "x" })).rejects.toThrow(/guarantee/);
    b = await decide(b, "Student Purchase", "Approved", { has_bank_guarantee: true, bank_guarantee_amount: 500, bank_guarantee_details: "Reference" });
    expect(b.status).toBe("Finance Admin");
    expect(Number(b.bank_guarantee_amount)).toBe(500);
    b = await decide(b);
    await expect(db.query("select public.fn_amend_bill($1,$2,$3)", [b.id, { ...payload(billForm()), expected_revision: b.revision }, filer])).rejects.toThrow(/hold/);
    await expect(db.query("update public.purchase_register set amount=1 where bill_id=$1", [b.id])).rejects.toThrow();
  });
  it("requires a fresh Store approval after an Audit-held correction", async () => {
    const p = payload(billForm("TEST-U", 60000, "Minor"));
    let b = await submit(p); b = await decide(b, "Student Purchase"); b = await decide(b, "Audit", "Hold");
    b = (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...p, supplier_address: "Changed address", expected_revision: b.revision }, filer])).rows[0].bill;
    expect(b).toMatchObject({ status: "Student Purchase", snp: "Pending", audit: null, finance_admin: null });
  });
  it("enforces departmental write scope in the database as well as the API", async () => {
    await db.query("update public.employees set department='School of Chemical Sciences' where employee_code='TEST-E'");
    const b = await submit(); const held = await decide(b, "Finance Admin", "Hold");
    await expect(db.query("select public.fn_amend_bill($1,$2,$3)", [b.id, { ...payload(billForm()), expected_revision: held.revision }, { code: "TEST-E" }])).rejects.toThrow(/department/);
    await expect(submit(payload(billForm()), { code: "TEST-F", name: "F", role: "Finance Admin" })).rejects.toThrow(/cannot file/);
  });
  it("keeps account metadata in sync while preserving the bill's original department", async () => {
    const p = payload(billForm()); let b = await submit(p); b = await decide(b, "Finance Admin", "Hold");
    await db.query("update public.employees set department='School of Chemical Sciences',email='changed@example.test' where employee_code='TEST-U'");
    const account = (await db.query("select email,department from public.pda_balances where employee_id='TEST-U'")).rows[0];
    expect(account).toMatchObject({ email: "changed@example.test", department: "School of Chemical Sciences" });
    b = (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...p, expected_revision: b.revision }, filer])).rows[0].bill;
    expect(b.employee_department).toBe(department);
    await db.query("update public.employees set department=$1 where employee_code='TEST-U'", [department]);
  });
  it("prevents self approval even after a role change and revokes inactive actors", async () => {
    const b = await submit(payload(billForm("TEST-X")), { code: "TEST-X", name: "X", role: "User" });
    await db.query("update public.employees set employee_type='Finance Admin' where employee_code='TEST-X'");
    await expect(db.query("select public.fn_bill_action($1,'TEST-X','X','Finance Admin','Approved',null,$2)", [b.id, { expected_revision: b.revision }])).rejects.toThrow(/cannot decide/);
    await db.query("update public.employees set is_active=false where employee_code='TEST-X'");
    await expect(db.query("select public.fn_bill_action($1,'TEST-X','X','Finance Admin','Approved',null,$2)", [b.id, { expected_revision: b.revision }])).rejects.toThrow(/access has changed/);
  });
  it("releases rejected funds once and notes atomically", async () => {
    let b = await submit(); b = await decide(b, "Finance Admin", "Rejected");
    const n = (await db.query("select public.fn_note_bill($1,$2) as bill", [b.id, filer])).rows[0].bill;
    expect(n.noted).toBe(true);
    expect((await db.query("select public.fn_note_bill($1,$2) as bill", [b.id, filer])).rows[0].bill.revision).toBe(n.revision);
    await expect(decide(b)).rejects.toThrow();
  });
  it("serialises concurrent top-ups without lost updates", async () => {
    const before = Number((await db.query("select allocated from public.pda_balances where employee_id='TEST-U'")).rows[0].allocated);
    await Promise.all(Array.from({ length: 10 }, () => db.query("select public.fn_top_up_pda('TEST-U',100,'TEST-P')")));
    expect(Number((await db.query("select allocated from public.pda_balances where employee_id='TEST-U'")).rows[0].allocated)).toBe(before + 1000);
  });
  it("serialises event sequence numbers across concurrent notifications", async () => {
    const b = await submit();
    await Promise.all(Array.from({ length: 10 }, () => db.query("select public.fn_log_event($1,'System','Notified',null,null,null,'Test',null,null,null)", [b.id])));
    const seq = (await db.query("select seq from public.bill_approvals where bill_id=$1 order by seq", [b.id])).rows.map((r) => r.seq);
    expect(seq).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
  it("makes account close versus submission atomic and retains history", async () => {
    const results = await Promise.allSettled([submit(payload(billForm("TEST-Z"))), db.query("select public.fn_close_pda('TEST-Z','TEST-P')")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.query("select * from public.pda_balances where employee_id='TEST-Z'")).rows).toHaveLength(1);
  });
  it("protects the last Dean and prevents Finance Admin from changing privileged access", async () => {
    await expect(db.query("update public.employees set is_active=false where employee_code='TEST-D'")).rejects.toThrow(/last active Dean/);
    const c = await db.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.actor_code','TEST-F',true)");
      await expect(c.query("update public.employees set is_active=false where employee_code='TEST-A'")).rejects.toThrow(/Only the Dean/);
    } finally { await c.query("rollback"); c.release(); }
  });
  it("uses IST at the financial year boundary and never truncates large counters", async () => {
    expect((await db.query("select public.fn_financial_year('2026-03-31 20:00+00') as fy")).rows[0].fy).toBe("2026-27");
    await db.query("insert into public.counters(scope,value) values('bill:2090-91',99999)");
    expect((await db.query("select public.fn_next_bill_number('2090-05-01') as n")).rows[0].n).toBe("IITM/2090-91/100000");
    const code = (await db.query("select code from public.departments where name=$1", [department])).rows[0].code;
    await db.query("insert into public.counters(scope,value) values($1,9999)", [`reg:${code}:2090-91`]);
    expect((await db.query("select public.fn_next_register_serial($1,'2090-05-01') as n", [department])).rows[0].n).toBe(`${code}/2090-91/10000`);
  });
  it("retains one active Dean under simultaneous deactivations", async () => {
    await db.query("insert into public.employees(employee_code,employee_name,email,department,employee_type) values('TEST-D2','Second Dean','d2@example.test',$1,'Dean')", [department]);
    const outcomes = await Promise.allSettled([db.query("update public.employees set is_active=false where employee_code='TEST-D'"), db.query("update public.employees set is_active=false where employee_code='TEST-D2'")]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.query("select count(*)::integer as n from public.employees where employee_type='Dean' and is_active")).rows[0].n).toBe(1);
  });
  it("preserves balances and bills on repeat upgrades; ledgers are immutable", async () => {
    const before = (await db.query("select sum(po_value) as total,count(*) as n from public.bills")).rows[0];
    await db.query(readFileSync("db/migrations/0004_integrity.sql", "utf8"));
    expect((await db.query("select sum(po_value) as total,count(*) as n from public.bills")).rows[0]).toEqual(before);
    await expect(db.query("update public.change_log set actor_code='forged'")).rejects.toThrow(/append-only/);
    expect((await db.query("select count(*)::integer as n from public.pda_balances where allocated <> balance+committed+spent")).rows[0].n).toBe(0);
  });
  it("restores demo accounts without clearing history or resetting existing accounts on repeat seed", async () => {
    const seed = readFileSync("db/seed/0003_demo_data.sql", "utf8");
    const beforeBills = (await db.query("select * from public.bills order by id")).rows;
    const beforeEvents = (await db.query("select * from public.bill_approvals order by bill_id,seq")).rows;
    const beforeRegister = (await db.query("select * from public.purchase_register order by id")).rows;
    const beforeAccounts = (await db.query("select * from public.pda_balances order by employee_id")).rows;
    await db.query(seed);
    expect((await db.query("select employee_type from public.employees where employee_code='Dean'")).rows[0].employee_type).toBe("Dean");
    expect(Number((await db.query("select balance from public.pda_balances where employee_id='User'")).rows[0].balance)).toBe(250000);
    await db.query("update public.employees set is_active=false,email='retained@example.test' where employee_code='User'");
    await db.query("update public.pda_balances set allocated=1234,balance=1234 where employee_id='User'");
    const demoEmployee = (await db.query("select * from public.employees where employee_code='User'")).rows;
    const seededAccounts = (await db.query("select * from public.pda_balances order by employee_id")).rows;
    await db.query(seed);
    expect((await db.query("select * from public.employees where employee_code='User'")).rows).toEqual(demoEmployee);
    expect((await db.query("select * from public.pda_balances order by employee_id")).rows).toEqual(seededAccounts);
    expect(seededAccounts.filter((r) => beforeAccounts.some((old) => old.employee_id === r.employee_id))).toEqual(beforeAccounts);
    expect((await db.query("select * from public.bills order by id")).rows).toEqual(beforeBills);
    expect((await db.query("select * from public.bill_approvals order by bill_id,seq")).rows).toEqual(beforeEvents);
    expect((await db.query("select * from public.purchase_register order by id")).rows).toEqual(beforeRegister);
    expect((await db.query("select count(*)::integer as n from public.change_log where actor_code='demo-seed'")).rows[0].n).toBe(32);
  });
});
