"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IconPlus } from "@tabler/icons-react";
import AppShell, { canOpenPortalPages, sharedLinks } from "@/components/AppShell";
import { useConfirm } from "@/components/ConfirmProvider";
import Modal, { btn, Field, fieldClass } from "@/components/ui/modal";
import Notice, { type NoticeState } from "@/components/Notice";
import { EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui/page";
import { api, money } from "@/lib/api";
import { homeFor } from "@/lib/roles";

type Source = {
  code: string; description: string; group_name: string; kind: "pda" | "budget"; categories: string[];
  is_builtin: boolean; is_active: boolean; approved_by: string | null; approved_at: string;
  head_year: string | null; allocated: number | null; balance: number | null; committed: number | null; spent: number | null;
};

const CATEGORIES = ["Consumables", "Minor", "Major"] as const;
const BLANK = { code: "", description: "", group: "", categories: [...CATEGORIES] as string[] };
const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

/**
 * The Dean's office decides which sources of fund the portal uses. Bill
 * filers choose only from the sources approved here (and active); a new
 * source is a budget head that has no money until the Dean sanctions some on
 * its register. Sources are switched off, never deleted: bills and ledgers
 * that name them stay readable.
 */
export default function FundSourcesPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.employee_type;
  const allowed = status === "authenticated" && canOpenPortalPages(role);
  const confirm = useConfirm();

  const [sources, setSources] = useState<Source[] | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ...BLANK });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    else if (status === "authenticated" && !canOpenPortalPages(role)) window.location.replace(homeFor(role));
  }, [status, role]);

  const load = useCallback(async () => {
    const { data, error } = await api.get<{ sources: Source[] }>("/api/fund-sources?all=1");
    if (error) { setNotice({ kind: "bad", text: error }); return; }
    setSources(data!.sources);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const approve = async () => {
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) { setNotice({ kind: "bad", text: "Use 2 to 20 capital letters, digits or hyphens for the code, for example OH-36 or SRIC-GRANT." }); return; }
    if (!draft.description.trim()) { setNotice({ kind: "bad", text: "Describe the source of fund." }); return; }
    if (!draft.categories.length) { setNotice({ kind: "bad", text: "Choose which kinds of purchase it may pay for." }); return; }
    if (!(await confirm({
      title: `Approve ${code} as a source of fund?`,
      description: "Bill filers will be able to choose it as soon as you approve it. It has no money until you sanction some on its register.",
      details: [["Code", code], ["Description", draft.description.trim()], ["Group", draft.group.trim() || "Other sources of fund"], ["May pay for", draft.categories.join(", ")]],
      confirmLabel: "Approve source",
    }))) return;
    setBusy("new");
    const { error } = await api.post("/api/fund-sources", { code, description: draft.description, group: draft.group, categories: draft.categories });
    setBusy(null);
    if (error) { setNotice({ kind: "bad", text: error }); return; }
    setAdding(false);
    setDraft({ ...BLANK });
    setNotice({ kind: "ok", text: `${code} approved. Open its register to sanction funds before bills can be charged to it.` });
    await load();
  };

  const toggle = async (s: Source) => {
    const next = !s.is_active;
    if (!(await confirm({
      title: next ? `Switch ${s.code} back on?` : `Switch ${s.code} off?`,
      description: next ? "Bill filers will be able to choose it again."
        : "Filers will no longer be offered it. Bills already charged to it carry on, and its register stays open.",
      details: [["Source", `${s.code} — ${s.description}`]],
      confirmLabel: next ? "Switch on" : "Switch off",
      tone: next ? undefined : "danger",
    }))) return;
    setBusy(s.code);
    const { error } = await api.patch("/api/fund-sources", { code: s.code, is_active: next });
    setBusy(null);
    if (error) { setNotice({ kind: "bad", text: error }); return; }
    setNotice({ kind: "ok", text: `${s.code} is now ${next ? "on" : "off"}.` });
    await load();
  };

  if (!allowed) return null;

  return (
    <AppShell desk="Source of Funds" nav={[]} links={sharedLinks(role, "fund-sources")}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title="Source of Funds"
        description="The sources of fund a bill may be charged to. Bill filers choose only from the ones approved and switched on here."
        actions={
          <button onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
            <IconPlus className="size-4" /> Approve a source
          </button>
        }
      />
      {!sources ? <LoadingState label="Loading the sources of fund…" /> : (
        <Panel bodyClassName="overflow-x-auto">
          {sources.length === 0 ? <div className="p-5"><EmptyState title="No sources of fund yet" /></div> : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50"><tr>
                <th scope="col" className={th}>Source</th>
                <th scope="col" className={th}>May pay for</th>
                <th scope="col" className={`${th} text-right`}>This year</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((s) => (
                  <tr key={s.code} className={s.is_active ? "hover:bg-slate-50" : "bg-slate-50/60 text-slate-500"}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{s.code}</p>
                      <p className="text-slate-700">{s.description}</p>
                      <p className="text-xs text-slate-500">{s.group_name}{s.is_builtin ? " · standing source" : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{s.categories.join(", ")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {s.kind === "pda" ? <span className="text-xs text-slate-500">Each person&apos;s own PDA</span>
                        : s.allocated == null ? <span className="text-xs text-amber-700">No money sanctioned yet</span>
                        : <><p>{money(s.balance ?? 0)} free</p><p className="text-xs text-slate-500">of {money(s.allocated)} ({s.head_year})</p></>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.is_active ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>{s.is_active ? "On" : "Off"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {s.kind === "budget" && (
                        <Link href={`/fund-register/${encodeURIComponent(s.code)}`} className="rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50">Register</Link>
                      )}
                      {!s.is_builtin && (
                        <button onClick={() => toggle(s)} disabled={busy === s.code}
                          className={`ml-1 rounded-md px-2 py-1 font-medium disabled:opacity-50 ${s.is_active ? "text-red-700 hover:bg-red-50" : "text-blue-700 hover:bg-blue-50"}`}>
                          {s.is_active ? "Switch off" : "Switch on"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {adding && (
        <Modal
          title="Approve a source of fund"
          description="Bill filers will be offered it in the Source of Fund list. Sanction money to it on its register afterwards."
          onClose={() => setAdding(false)}
          footer={<>
            <button onClick={() => setAdding(false)} className={btn.secondary}>Cancel</button>
            <button onClick={approve} disabled={busy === "new"} className={btn.primary}>{busy === "new" ? "Saving…" : "Approve source"}</button>
          </>}
        >
          <Field label="Code" hint="Capital letters, digits and hyphens, e.g. OH-36 or SRIC-GRANT. It cannot be changed later.">
            <input autoFocus value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} maxLength={20} className={fieldClass} />
          </Field>
          <Field label="Description">
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={120} placeholder="e.g. Sponsored research grant" className={fieldClass} />
          </Field>
          <Field label="Group (optional)" hint="Sources with the same group are listed together in the form.">
            <input value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} maxLength={80} placeholder="Other sources of fund" className={fieldClass} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">May pay for</legend>
            <div className="flex flex-wrap gap-4">
              {CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.categories.includes(c)}
                    onChange={(e) => setDraft({ ...draft, categories: e.target.checked ? [...draft.categories, c] : draft.categories.filter((x) => x !== c) })} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        </Modal>
      )}
    </AppShell>
  );
}
