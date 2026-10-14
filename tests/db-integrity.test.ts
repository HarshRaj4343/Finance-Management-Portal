import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { toPayload, type FormState } from "@/app/apply-bill/bill-form/model";
import { billForm } from "./fixtures";
import { recordedBillDates } from "@/lib/bill-review";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL financial integrity (isolated database only)", () => {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
  const filer = { code: "TEST-C", name: "Test clerk", role: "Bill Employee" };
  const department = "School of Computing & Electrical Engineering";
  const payload = (f: FormState) => ({ ...toPayload(f), form_data: f, invoice_no: f.billNo, invoice_date: f.billDate,
    date_of_delivery: f.deliveryDate, date_of_installation: f.installRequired === "yes" ? f.installDate : null, submission_key: randomUUID() });
  const fileBill = async (p: Record<string, unknown> = payload(billForm()), actor = filer) => (await db.query("select public.fn_submit_bill($1,$2) as bill", [p, actor])).rows[0].bill;
  // Most tests decide straight away, so close the five-minute edit window first.
  const closeWindow = async (b: { id: string }) => (await db.query("update public.bills set editable_until=now() where id=$1 returning to_jsonb(bills.*) as bill", [b.id])).rows[0].bill;
  const submit = async (p: Record<string, unknown> = payload(billForm()), actor = filer) => closeWindow(await fileBill(p, actor));
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
    const next = payload({ ...p.form_data, category: "Major", poValue: "90000", lines: [{ ...p.form_data.lines[0], unitPrice: "90000" }] });
    b = await closeWindow((await amend(next)).rows[0].bill);
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
    await db.query(readFileSync("db/migrations/0005_bill_form_review.sql", "utf8"));
    await db.query(readFileSync("db/migrations/0006_edit_window.sql", "utf8"));
    await db.query(readFileSync("db/migrations/0007_fund_heads.sql", "utf8"));
    await db.query(readFileSync("db/migrations/0008_movement_registers.sql", "utf8"));
    expect((await db.query("select sum(po_value) as total,count(*) as n from public.bills")).rows[0]).toEqual(before);
    await expect(db.query("update public.change_log set actor_code='forged'")).rejects.toThrow(/append-only/);
    expect((await db.query("select count(*)::integer as n from public.pda_balances where allocated <> balance+committed+spent")).rows[0].n).toBe(0);
  });
  it("matches purchase value to quantity times unit price, ignoring legacy charges, without reserving invalid bills", async () => {
    const before = (await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0];
    const counts = (await db.query("select (select count(*) from public.bills) bills,(select count(*) from public.bill_approvals) events")).rows[0];
    const f = billForm(); f.lines[0].qty = "3"; f.lines[0].unitPrice = "123.45";
    for (const amount of ["370.34", "370.36", "380.50"]) {
      f.poValue = amount;
      await expect(submit(payload(f))).rejects.toThrow(/purchase value/);
    }
    expect((await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0]).toEqual(before);
    expect((await db.query("select (select count(*) from public.bills) bills,(select count(*) from public.bill_approvals) events")).rows[0]).toEqual(counts);
    f.poValue = "370.35";
    const b = await submit(payload(f)); expect(Number(b.po_value)).toBe(370.35);
  });
  it("enforces invoice before delivery and installation even for direct SQL calls, allowing equality", async () => {
    const f = billForm(); f.installRequired = "yes"; f.installDone = "yes"; f.installDate = "2026-01-03";
    f.deliveryDate = "2025-12-31";
    await expect(submit(payload(f))).rejects.toThrow(/Bill date/);
    f.deliveryDate = "2026-01-02"; f.installDate = "2025-12-31";
    await expect(submit(payload(f))).rejects.toThrow(/installation/);
    f.installDate = "2026-01-01";
    await expect(submit(payload(f))).rejects.toThrow(/installation/);
    f.installDate = f.deliveryDate = f.billDate;
    expect(recordedBillDates(await submit(payload(f))).delivery).toBe("2026-01-01");
  });
  it("connects PDA fund selection to reservation and settlement and preserves it in the register", async () => {
    const f = billForm("TEST-U", 333); f.fund = "PDA";
    const before = (await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0];
    let b = await submit(payload(f));
    const reserved = (await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0];
    expect(Number(reserved.balance)).toBe(Number(before.balance) - 333);
    expect(Number(reserved.committed)).toBe(Number(before.committed) + 333);
    b = await decide(b);
    const settled = (await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0];
    expect(Number(settled.spent)).toBe(Number(before.spent) + 333);
    expect(Number(settled.committed)).toBe(Number(before.committed));
    expect((await db.query("select source_of_fund from public.purchase_register where bill_id=$1", [b.id])).rows[0].source_of_fund).toBe("PDA");
  });
  it("blocks durable equipment in consumables and keeps repeated review migrations data-neutral", async () => {
    const f = billForm(); f.lines[0].type = "MacBook";
    await expect(submit(payload(f))).rejects.toThrow(/consumable/);
    for (const table of ["bills", "bill_approvals", "pda_balances", "purchase_register", "change_log"]) {
      const sql = `select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by row_to_json(t)::text),'')) fingerprint from public.${table} t`;
      const before = (await db.query(sql)).rows[0];
      await db.query(readFileSync("db/migrations/0005_bill_form_review.sql", "utf8"));
      expect((await db.query(sql)).rows[0]).toEqual(before);
    }
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
    expect((await db.query("select count(*)::integer as n from public.change_log where actor_code='demo-seed'")).rows[0].n).toBe(30);
    expect((await db.query("select count(*)::integer as n from public.employees where employee_code='Bill-edit'")).rows[0].n).toBe(0);
  });
  it("keeps a new bill with its filer for the edit window, then lets the desk decide", async () => {
    const p = payload(billForm("TEST-U", 1200)); let b = await fileBill(p);
    expect(new Date(b.editable_until).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    await expect(decide(b)).rejects.toThrow(/correction window/);
    await expect(db.query("update public.bills set finance_admin='Approved' where id=$1", [b.id])).rejects.toThrow(/correction window/);
    const before = (await db.query("select balance,committed from public.pda_balances where employee_id='TEST-U'")).rows[0];
    const next = payload({ ...p.form_data, poValue: "1500", lines: [{ ...p.form_data.lines[0], unitPrice: "1500" }] });
    b = (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...next, expected_revision: b.revision }, filer])).rows[0].bill;
    expect(Number(b.po_value)).toBe(1500);
    const after = (await db.query("select balance,committed from public.pda_balances where employee_id='TEST-U'")).rows[0];
    expect(Number(after.committed) - Number(before.committed)).toBe(300);
    b = await closeWindow(b);
    await expect(db.query("select public.fn_amend_bill($1,$2,$3)", [b.id, { ...next, expected_revision: b.revision }, filer])).rejects.toThrow(/only within/);
    expect((await decide(b)).status).toBe("Accepted");
  });
  it("lets the filer correct a rejected bill, reserving its funds again and restarting the route", async () => {
    const p = payload(billForm("TEST-U", 2000, "Minor")); let b = await submit(p);
    b = await decide(b, "Student Purchase", "Rejected");
    const released = (await db.query("select balance,committed from public.pda_balances where employee_id='TEST-U'")).rows[0];
    b = (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...p, expected_revision: b.revision }, filer])).rows[0].bill;
    expect(b).toMatchObject({ status: "Student Purchase", snp: "Pending", decided_at: null, pda_committed: true, noted: false });
    const reserved = (await db.query("select balance,committed from public.pda_balances where employee_id='TEST-U'")).rows[0];
    expect(Number(released.balance) - Number(reserved.balance)).toBe(2000);
    expect(Number(reserved.committed) - Number(released.committed)).toBe(2000);
    b = await closeWindow(b); b = await decide(b, "Student Purchase"); b = await decide(b);
    expect(b.status).toBe("Accepted");
    expect((await db.query("select count(*)::integer as n from public.pda_balances where allocated <> balance+committed+spent")).rows[0].n).toBe(0);
  });
  it("refuses to reopen a rejected bill whose invoice was already refiled", async () => {
    const p = payload(billForm("TEST-U", 700)); let b = await submit(p);
    b = await decide(b, "Finance Admin", "Rejected");
    await submit({ ...p, submission_key: randomUUID() });
    await expect(db.query("select public.fn_amend_bill($1,$2,$3)", [b.id, { ...p, expected_revision: b.revision }, filer])).rejects.toThrow(/already uses this supplier invoice/);
  });

  describe("OH-31 and OH-35 budget heads", () => {
    const dean = async () => (await db.query("select employee_code from public.employees where employee_type='Dean' and is_active order by employee_code limit 1")).rows[0].employee_code;
    const fy = async () => (await db.query("select public.fn_financial_year() as fy")).rows[0].fy as string;
    const head = async (code: string) => (await db.query("select allocated,balance,committed,spent from public.fund_heads where code=$1 and financial_year=public.fn_financial_year()", [code])).rows[0];
    const pda = async () => (await db.query("select balance,committed,spent from public.pda_balances where employee_id='TEST-U'")).rows[0];
    const allocate = async (code: string, amount: number, actor?: string) =>
      db.query("select public.fn_add_fund_allocation($1,$2,$3,'MoE sanction 1',null,'Test',$4) as head", [code, await fy(), amount, actor ?? await dean()]);
    const withFund = (amount: number, category: string, fund: string) => { const f = billForm("TEST-U", amount, category); f.fund = fund; return payload(f); };

    it("charges OH bills to their head, never the applicant's PDA, and keeps a permanent ledger", async () => {
      await allocate("OH-31", 10000);
      const before = await pda();
      let b = await submit(withFund(2000, "Consumables", "OH-31"));
      expect(b).toMatchObject({ funding_pool: "OH-31", funding_fy: await fy() });
      expect(await pda()).toEqual(before);
      expect(await head("OH-31")).toMatchObject({ allocated: "10000.00", balance: "8000.00", committed: "2000.00" });
      b = await decide(b, "Finance Admin", "Rejected");
      expect(await head("OH-31")).toMatchObject({ balance: "10000.00", committed: "0.00" });
      b = await decide(await submit(withFund(2500, "Consumables", "OH-31")));
      expect(b.status).toBe("Accepted");
      expect(await head("OH-31")).toMatchObject({ balance: "7500.00", committed: "0.00", spent: "2500.00" });
      expect(await pda()).toEqual(before);
      const kinds = (await db.query("select kind from public.fund_head_entries where code='OH-31' order by id")).rows.map((r) => r.kind);
      expect(kinds).toEqual(["Allocation", "Reserved", "Released", "Reserved", "Spent"]);
      expect((await db.query("select source_of_fund from public.purchase_register where bill_id=$1", [b.id])).rows[0].source_of_fund).toBe("OH-31");
      await expect(db.query("update public.fund_head_entries set amount=1")).rejects.toThrow(/append-only/);
      expect((await db.query("select count(*)::integer as n from public.fund_heads where allocated <> balance+committed+spent")).rows[0].n).toBe(0);
    });

    it("refuses unfunded or overspent heads, non-Dean allocations and fund/category mismatches", async () => {
      await expect(submit(withFund(1000, "Major", "OH-35"))).rejects.toThrow(/No OH-35 budget/);
      await expect(submit(withFund(1000, "Consumables", "OH-35"))).rejects.toThrow(/capital assets/);
      await expect(submit(withFund(1000, "Major", "OH-31"))).rejects.toThrow(/recurring/);
      await expect(submit(withFund(999999, "Consumables", "OH-31"))).rejects.toThrow(/Insufficient OH-31/);
      await expect(allocate("OH-35", 500, "TEST-F")).rejects.toThrow(/Only the Dean/);
      await expect(allocate("OH-35", -5)).rejects.toThrow(/positive/);
      await allocate("OH-35", 50000);
      const b = await submit(withFund(40000, "Major", "OH-35"));
      expect(b.funding_pool).toBe("OH-35");
      expect((await submit(withFund(300, "Minor", "OH-31"))).funding_pool).toBe("OH-31");
    });

    it("moves the reservation between pools when a correction changes the fund", async () => {
      const p = withFund(500, "Consumables", "PDA");
      let b = await submit(p);
      const reserved = await pda();
      const headBefore = await head("OH-31");
      b = await decide(b, "Finance Admin", "Hold");
      const moved = { ...p, ...withFund(500, "Consumables", "OH-31"), invoice_no: p.invoice_no, form_data: { ...p.form_data, fund: "OH-31" }, source_of_fund: "OH-31" };
      b = (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...moved, expected_revision: b.revision }, filer])).rows[0].bill;
      expect(b.funding_pool).toBe("OH-31");
      const after = await pda();
      expect(Number(reserved.committed) - Number(after.committed)).toBe(500);
      expect(Number((await head("OH-31")).committed) - Number(headBefore.committed)).toBe(500);
    });
  });

  describe("inward and outward registers", () => {
    const moves = async (id: string) => (await db.query(
      "select register, desk, nature, counterpart, serial_no from public.bill_movements where bill_id=$1 order by id", [id])).rows;
    const amend = async (b: { id: string; revision: number }, p: Record<string, unknown>) =>
      (await db.query("select public.fn_amend_bill($1,$2,$3) as bill", [b.id, { ...p, expected_revision: b.revision }, filer])).rows[0].bill;

    it("records every arrival and dispatch of a bill, desk by desk, with permanent serials", async () => {
      const p = payload(billForm("TEST-U", 60000, "Minor"));
      let b = await submit(p);
      b = await decide(b, "Student Purchase");
      b = await decide(b, "Audit", "Hold");
      b = await closeWindow(await amend(b, p));
      b = await decide(b, "Student Purchase"); b = await decide(b, "Audit"); b = await decide(b);
      expect(b.status).toBe("Accepted");
      const m = await moves(b.id);
      expect(m.map((r) => [r.register, r.desk, r.nature])).toEqual([
        ["Inward", "Student Purchase", "New bill"],
        ["Outward", "Student Purchase", "Approved and forwarded"],
        ["Inward", "Audit", "Forwarded"],
        ["Outward", "Audit", "On hold"],
        ["Inward", "Student Purchase", "Correction"],
        ["Outward", "Student Purchase", "Approved and forwarded"],
        ["Inward", "Audit", "Forwarded"],
        ["Outward", "Audit", "Approved and forwarded"],
        ["Inward", "Finance Admin", "Forwarded"],
        ["Outward", "Finance Admin", "Final approval"],
      ]);
      expect(m[1].counterpart).toBe("Audit");
      expect(m[2].counterpart).toBe("Store and Purchase Department");
      expect(m.at(-1)!.counterpart).toMatch(/purchase register/);
      expect(m[0].serial_no).toMatch(/^SNP\/IN\/\d{4}-\d{2}\/\d{5}$/);
      expect(m.at(-1)!.serial_no).toMatch(/^FA\/OUT\//);
      await expect(db.query("update public.bill_movements set nature='x' where bill_id=$1", [b.id])).rejects.toThrow(/append-only/);
      expect((await db.query("select count(*)::integer as n from (select serial_no from public.bill_movements group by serial_no having count(*) > 1) d")).rows[0].n).toBe(0);
    });

    it("records a recall inside the edit window and a resubmission after rejection", async () => {
      const p = payload(billForm("TEST-U", 900));
      let b = await fileBill(p);
      b = await closeWindow(await amend(b, p));
      b = await decide(b, "Finance Admin", "Rejected");
      b = await amend(b, p);
      expect((await moves(b.id)).map((r) => [r.register, r.nature])).toEqual([
        ["Inward", "New bill"],
        ["Outward", "Recalled by filer for correction"],
        ["Inward", "Correction"],
        ["Outward", "Rejected"],
        ["Inward", "Resubmitted after rejection"],
      ]);
    });
  });
});
