"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { IconPlus } from "@tabler/icons-react";
import AppShell, { canOpenPortalPages, sharedLinks } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmProvider";
import Modal, { btn, Field } from "@/components/ui/modal";
import Notice, { type NoticeState } from "@/components/Notice";
import { EmptyState, ExportButton, LoadingState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/page";
import { api, money, when, dateOnly } from "@/lib/api";
import { homeFor } from "@/lib/roles";

type Head = { code: string; financial_year: string; allocated: number; balance: number; committed: number; spent: number };
type Allocation = { id: number; financial_year: string; amount: number; reference: string | null; entry_date: string; remarks: string | null; actor_code: string | null };
type Movement = {
  id: number; financial_year: string; kind: "Reserved" | "Released" | "Spent"; amount: number; recorded_at: string;
  bill_id: string; bill_number: string | null; employee_id: string; employee_name: string | null; employee_department: string | null;
  item_description: string | null; status: string; serial_no: string | null;
};
type Payload = { code: string; heads: Head[]; allocations: Allocation[]; movements: Movement[]; currentYear: string | null };

const HEADS: Record<string, { title: string; description: string }> = {
  "OH-31": { title: "OH-31 Register", description: "General (recurring) institute budget: sanctions received and every bill charged to it." },
  "OH-35": { title: "OH-35 Register", description: "Creation of capital assets: sanctions received and every bill charged to it." },
};

const shiftYear = (fy: string, by: number) => {
  const start = Number(fy.slice(0, 4)) + by;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};
const field = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
const MOVEMENT_TEXT: Record<Movement["kind"], string> = { Reserved: "Reserved", Released: "Released", Spent: "Spent" };

/** The Dean's head-wise register: budget per financial year, sanctions and bill-wise expenditure. */
export default function FundRegisterPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = decodeURIComponent(raw ?? "").toUpperCase();
  const meta = HEADS[code];
  const { data: session, status } = useSession();
  const role = session?.user?.employee_type;
  const allowed = status === "authenticated" && canOpenPortalPages(role) && Boolean(meta);
  const confirm = useConfirm();

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [fy, setFy] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ financial_year: "", amount: "", reference: "", date: "", remarks: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    else if (status === "authenticated" && (!canOpenPortalPages(role) || !meta)) window.location.replace(homeFor(role));
  }, [status, role, meta]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get<Payload>(`/api/fund-heads?code=${encodeURIComponent(code)}`);
    setLoading(false);
    if (error) { setNotice({ kind: "bad", text: error }); return; }
    setPayload(data);
    setFy((current) => current || data!.currentYear || data!.heads[0]?.financial_year || "");
  }, [code]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const years = useMemo(() => {
    const set = new Set<string>(payload?.heads.map((h) => h.financial_year) ?? []);
    if (payload?.currentYear) { set.add(payload.currentYear); set.add(shiftYear(payload.currentYear, 1)); }
    return [...set].sort().reverse();
  }, [payload]);
  const head = payload?.heads.find((h) => h.financial_year === fy);
  const allocations = payload?.allocations.filter((a) => a.financial_year === fy) ?? [];
  const movements = payload?.movements.filter((m) => m.financial_year === fy) ?? [];

  const openAdd = () => {
    setDraft({ financial_year: fy || payload?.currentYear || "", amount: "", reference: "", date: "", remarks: "" });
    setAdding(true);
  };

  const save = async () => {
    const amount = Number(draft.amount);
    if (!draft.financial_year) { setNotice({ kind: "bad", text: "Choose the financial year." }); return; }
    if (!(amount > 0)) { setNotice({ kind: "bad", text: "Enter an amount greater than zero." }); return; }
    if (!draft.reference.trim()) { setNotice({ kind: "bad", text: "Enter the sanction letter or order reference." }); return; }
    if (!(await confirm({
      title: `Add ${money(amount)} to ${code}?`,
      description: "Allocations are permanent entries in the register and cannot be edited or removed.",
      details: [["Head", code], ["Financial year", draft.financial_year], ["Amount", money(amount)],
        ["Reference", draft.reference.trim()], ["Sanction date", draft.date || "Today"], ["Remarks", draft.remarks.trim() || "None"]],
      confirmLabel: "Add funding",
    }))) return;
    setSaving(true);
    const { error } = await api.post("/api/fund-heads", { code, ...draft, amount });
    setSaving(false);
    if (error) { setNotice({ kind: "bad", text: error }); return; }
    setAdding(false);
    setFy(draft.financial_year);
    setNotice({ kind: "ok", text: `${money(amount)} added to ${code} for ${draft.financial_year}.` });
    await load();
  };

  if (!allowed) return null;

  return (
    <AppShell desk={meta.title} nav={[]} links={sharedLinks(role, code as "OH-31" | "OH-35")}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Financial year
              <select value={fy} onChange={(e) => setFy(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <ExportButton href={`/api/fund-heads?code=${encodeURIComponent(code)}${fy ? `&fy=${fy}` : ""}&format=csv`} />
            <button onClick={openAdd} className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
              <IconPlus className="size-4" /> Add funding
            </button>
          </>
        }
      />

      {loading && !payload ? <LoadingState label="Loading the register…" /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Allocated" value={money(head?.allocated ?? 0)} hint={`Sanctioned for ${fy || "this year"}`} />
            <StatCard label="Available" value={money(head?.balance ?? 0)} hint="Free for new bills" tone="green" />
            <StatCard label="Committed" value={money(head?.committed ?? 0)} hint="Reserved by bills in progress" tone="amber" />
            <StatCard label="Spent" value={money(head?.spent ?? 0)} hint="Finally approved bills" tone="blue" />
          </div>

          <Panel title="Sanctions" bodyClassName="overflow-x-auto">
            {allocations.length === 0 ? (
              <div className="p-5"><EmptyState title={`No ${code} funding for ${fy}`} description="Use Add funding to record a sanction letter or order." /></div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr>
                  <th scope="col" className={th}>Date</th><th scope="col" className={th}>Reference</th><th scope="col" className={`${th} text-right`}>Amount</th><th scope="col" className={th}>Remarks</th><th scope="col" className={th}>Entered by</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {allocations.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-4 py-3">{dateOnly(a.entry_date)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{a.reference}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(a.amount)}</td>
                      <td className="max-w-md px-4 py-3 text-slate-700">{a.remarks || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{a.actor_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Expenditure" bodyClassName="overflow-x-auto">
            {movements.length === 0 ? (
              <div className="p-5"><EmptyState title={`No bills charged to ${code} in ${fy}`} /></div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr>
                  <th scope="col" className={th}>When</th><th scope="col" className={th}>Bill</th><th scope="col" className={th}>Employee</th><th scope="col" className={th}>Movement</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th><th scope="col" className={th}>Register serial</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(m.recorded_at)}</td>
                      <td className="max-w-xs px-4 py-3">
                        <Link href={`/bill/${m.bill_id}`} className="whitespace-nowrap font-mono text-xs font-medium text-blue-700 hover:underline">{m.bill_number ?? "—"}</Link>
                        <p className="truncate text-slate-700">{m.item_description || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap">{m.employee_name} <span className="text-xs text-slate-500">({m.employee_id})</span></p>
                        <p className="max-w-[14rem] truncate text-xs text-slate-500">{m.employee_department}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={m.kind === "Spent" ? "Approved" : m.kind === "Released" ? "Reject" : "Pending"} className="mr-1" />
                        <span className="text-xs text-slate-500">{MOVEMENT_TEXT[m.kind]}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{m.kind === "Released" ? "−" : ""}{money(m.amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{m.serial_no ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <p className="text-center text-xs text-slate-500">Register entries are permanent. They cannot be edited or deleted once written.</p>
        </>
      )}

      {adding && (
        <Modal
          title={`Add ${code} funding`}
          description="Record a sanction letter or order. Allocations are permanent and cannot be edited or removed."
          onClose={() => setAdding(false)}
          footer={<>
            <button onClick={() => setAdding(false)} className={btn.secondary}>Cancel</button>
            <button onClick={save} disabled={saving} className={btn.primary}>{saving ? "Saving…" : "Add funding"}</button>
          </>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Financial year">
              <select value={draft.financial_year} onChange={(e) => setDraft({ ...draft, financial_year: e.target.value })} className={field}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input type="number" min={0} step="0.01" autoFocus value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className={field} />
            </Field>
          </div>
          <Field label="Sanction letter / order reference">
            <input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="e.g. MoE F.No. 20-1/2026-TS.I" className={field} />
          </Field>
          <Field label="Sanction date">
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={field} />
          </Field>
          <Field label="Remarks (optional)">
            <textarea rows={2} value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </Field>
        </Modal>
      )}
    </AppShell>
  );
}
