// UploadBill.tsx
"use client";

/**
 * The bill form, as a six-step wizard (Bill-form.md §2, §3, §10).
 *
 * Step logic and validation live in ./bill-form/model.ts; this file owns the
 * wizard: stepper, draft autosave, the sticky action bar, submission and the
 * confirmation screen. Nothing here changes what /api/bills accepts --
 * toPayload() folds the richer form into the existing columns.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { isUmbrellaDepartment, routeAfter } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { BillRow } from "@/types/database";
import { Banner, Button } from "./bill-form/ui";
import {
  Draft, FormState, STEPS, clearDraft, emptyForm, inr, loadDraft, saveDraft, stepOfField, toPayload, totals, validateStep,
} from "./bill-form/model";
import { Lookup, StepBill, StepSubmitter, StepSupplier } from "./bill-form/steps-basic";
import { StepFunding, StepItems } from "./bill-form/steps-items";
import { StepReview, SummaryPanel } from "./bill-form/review";

interface UploadBillProps {
  onBillSubmitted: () => void;
  department?: string | null;
}

type Done = { id: string; number: string; total: number; status: string; supplier: string; at: Date };

const LAST = STEPS.length - 1;
/** Errors on these only make sense once the person has tried to submit. */
const DECLARATIONS = ["f-declaration", "f-total-confirmed"];

const UploadBill: React.FC<UploadBillProps> = ({ onBillSubmitted, department }) => {
  const { data: session } = useSession();
  const draftKey = `iitm-bill-draft:${session?.user?.id ?? "anon"}`;

  const [f, setF] = useState<FormState>(emptyForm);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Draft | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastSaved = useRef<string>("");

  const set = useCallback((patch: Partial<FormState>) => setF((p) => ({ ...p, ...patch })), []);

  const submitter = {
    id: session?.user?.employee_code ?? session?.user?.username ?? "",
    name: session?.user?.name ?? "",
    department: department ?? session?.user?.department ?? "",
  };

  // ---- the person who placed the order: looked up as the ID is typed ----
  useEffect(() => {
    const code = f.requesterCode.trim();
    if (!code) {
      setLookup({ state: "idle" });
      return;
    }
    setLookup((l) => ({ ...l, state: "looking" }));
    const t = setTimeout(async () => {
      const { data, error } = await api.get<{
        found: boolean;
        employee?: { employee_name: string; department: string };
        pda?: { balance: number | string; committed: number | string } | null;
        message?: string | null;
      }>(`/api/lookup/employee?code=${encodeURIComponent(code)}`);
      if (error || !data?.found || !data.employee) {
        setLookup({ state: "missing", message: error ?? data?.message ?? "That employee ID could not be found." });
        return;
      }
      setLookup({
        state: "found",
        name: data.employee.employee_name,
        department: data.employee.department,
        balance: data.pda ? Number(data.pda.balance) : null,
        committed: data.pda ? Number(data.pda.committed) : null,
        message: data.message,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [f.requesterCode]);

  const ctx = {
    requesterFound: lookup.state === "found",
    requesterDepartment: lookup.department ?? null,
    // Store and Purchase files for every school, so no department lock.
    filingDepartment: isUmbrellaDepartment(department) ? null : (department ?? null),
    pdaBalance: lookup.balance ?? null,
    hasPda: lookup.state === "found" && lookup.balance != null,
  };

  // ---- errors: shown once a field is left, or after a failed Next ----
  const all = validateStep(step, f, ctx);
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    const showNow = attempted || touched.has(k) || (step === LAST && !DECLARATIONS.includes(k));
    if (showNow) errors[k] = v;
  }

  // ---- drafts (this browser only) ----
  const snapshot = JSON.stringify({ f, step });
  const dirty = snapshot !== lastSaved.current;
  const hasContent = f.requesterCode || f.supplierName || f.billNo || f.lines.some((l) => l.group);

  const persist = useCallback(() => {
    const draft: Draft = { form: f, step, savedAt: Date.now() };
    if (saveDraft(draftKey, draft)) {
      lastSaved.current = JSON.stringify({ f, step });
      setSavedAt(draft.savedAt);
    }
  }, [f, step, draftKey]);

  const persistRef = useRef(persist);
  persistRef.current = persist;
  const stateRef = useRef({ dirty, hasContent, done });
  stateRef.current = { dirty, hasContent, done };

  useEffect(() => {
    if (!session?.user?.id) return;
    const d = loadDraft(draftKey);
    if (d) setPending(d);
  }, [draftKey, session?.user?.id]);

  useEffect(() => {
    const t = setInterval(() => {
      const s = stateRef.current;
      if (s.dirty && s.hasContent && !s.done) persistRef.current();
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const s = stateRef.current;
      if (s.dirty && s.hasContent && !s.done) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const savedLabel = (() => {
    if (!savedAt) return dirty && hasContent ? "Unsaved changes" : "Not saved yet";
    const s = Math.max(0, Math.round((now - savedAt) / 1000));
    const ago = s < 45 ? "just now" : `${Math.round(s / 60) || 1} min ago`;
    return dirty ? `Saved ${ago}, with newer changes` : `Saved ${ago}`;
  })();

  // ---- moving around ----
  const focusKey = (key: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(key) ?? document.querySelector<HTMLElement>(`[id^="${key}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    });
  };

  const goTo = (n: number) => {
    if (hasContent && dirty) persist();
    setStep(n);
    setReached((r) => Math.max(r, n));
    setAttempted(false);
    setTouched(new Set());
    setSubmitError(null);
    requestAnimationFrame(() => {
      top.current?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    });
  };

  const next = () => {
    const e = validateStep(step, f, ctx);
    const keys = Object.keys(e);
    if (keys.length) {
      setAttempted(true);
      focusKey(keys[0]);
      return;
    }
    goTo(step + 1);
  };

  const submit = async () => {
    for (let s = 0; s < STEPS.length; s++) {
      const e = validateStep(s, f, ctx);
      const keys = Object.keys(e);
      if (keys.length) {
        const target = s === LAST ? LAST : Math.min(s, stepOfField(keys[0]));
        if (target !== step) goTo(target);
        setAttempted(true);
        focusKey(keys[0]);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    const { data, error } = await api.post<{ bill: BillRow }>(
      "/api/bills",
      toPayload({ ...f, requesterName: lookup.name ?? f.requesterName })
    );
    setSubmitting(false);

    if (error || !data) {
      setSubmitError(error ?? "The bill could not be filed.");
      requestAnimationFrame(() => top.current?.scrollTo({ top: 0, behavior: "smooth" }));
      return;
    }
    clearDraft(draftKey);
    lastSaved.current = "";
    setDone({
      id: data.bill.id,
      number: data.bill.bill_number ?? "",
      total: totals(f).total,
      status: data.bill.status,
      supplier: f.supplierName,
      at: new Date(),
    });
    onBillSubmitted();
  };

  const reset = () => {
    setF(emptyForm());
    setStep(0);
    setReached(0);
    setTouched(new Set());
    setAttempted(false);
    setSubmitError(null);
    setDone(null);
    setSavedAt(null);
    lastSaved.current = "";
    setLookup({ state: "idle" });
    setConfirmCancel(false);
  };

  // ---------------------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------------------
  if (done) {
    return (
      <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto">
        <style>{`@media print{body *{visibility:hidden}#ack,#ack *{visibility:visible}#ack{position:absolute;left:0;top:0;width:100%}.no-print{display:none!important}}`}</style>
        <div id="ack" className="rounded-xl border border-green-300 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-3" role="status">
            <CheckCircle2 className="mt-0.5 size-7 shrink-0 text-green-600" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Bill submitted</h1>
              <p className="mt-1 text-sm text-slate-600">
                {inr(done.total)} is reserved against the PDA of {f.requesterCode.trim() || "the employee"}.
                The bill is now with <strong>{done.status}</strong>.
              </p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Bill Reference ID</dt>
              <dd className="mt-0.5 font-mono text-base font-semibold text-slate-900">{done.number || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Total</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{inr(done.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Supplier</dt>
              <dd className="mt-0.5">{done.supplier}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Submitted</dt>
              <dd className="mt-0.5">{done.at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd>
            </div>
          </dl>
          <div className="no-print mt-6 flex flex-wrap gap-3">
            <a
              href={`/bill/${done.id}`}
              className="inline-flex h-10 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
            >
              View Bill
            </a>
            <Button variant="outline" onClick={() => window.print()}>
              Print / Save Acknowledgement as PDF
            </Button>
            <Button variant="text" onClick={reset}>
              Submit Another Bill
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // The wizard
  // ---------------------------------------------------------------------
  const errorList = attempted ? Object.entries(all) : [];
  const stepProps = { f, set, errors };
  const canSubmit = Object.keys(validateStep(LAST, f, ctx)).length === 0 && !submitting;
  const route = totals(f).total > 0 ? routeAfter("Submit", f.category, totals(f).total) : null;

  return (
    <div className="flex h-full min-h-0 w-full max-w-6xl flex-col self-stretch mx-auto">
      {/* header */}
      <header className="shrink-0 pb-4">
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-800 hover:underline">Home</Link> / Bills / <span className="text-slate-800">New Bill</span>
        </nav>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            New Bill{department ? <span className="font-normal text-slate-500"> · {department}</span> : null}
          </h1>
          <div className="flex items-center gap-3 text-xs">
            <span className="rounded-full bg-slate-200 px-2.5 py-1 font-medium text-slate-700">Draft</span>
            <span className="text-slate-500" role="status" aria-live="polite">{savedLabel}</span>
          </div>
        </div>
      </header>

      {/* stepper */}
      <Stepper step={step} reached={reached} onGo={goTo} />

      {/* body */}
      <div ref={top} className="min-h-0 flex-1 overflow-y-auto pb-6 pr-1">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
              {STEPS[step].label}
              <span className="ml-2 text-sm font-normal text-slate-500">Step {step + 1} of {STEPS.length}</span>
            </h2>

            {pending && !hasContent && (
              <Banner tone="info">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    You have a draft saved on {new Date(pending.savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.
                  </span>
                  <span className="flex gap-2">
                    <Button
                      className="h-8 px-3 text-xs"
                      onClick={() => {
                        setF(pending.form);
                        setStep(Math.min(pending.step, LAST));
                        setReached(Math.min(pending.step, LAST));
                        lastSaved.current = JSON.stringify({ f: pending.form, step: pending.step });
                        setSavedAt(pending.savedAt);
                        setPending(null);
                      }}
                    >
                      Resume draft
                    </Button>
                    <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => { clearDraft(draftKey); setPending(null); }}>
                      Discard
                    </Button>
                  </span>
                </div>
              </Banner>
            )}

            {submitError && (
              <div role="alert">
                <Banner tone="error">{submitError}</Banner>
              </div>
            )}

            {errorList.length > 0 && (
              <div role="alert" aria-live="assertive">
                <Banner tone="error">
                  <p className="font-medium">
                    Fix {errorList.length} {errorList.length === 1 ? "problem" : "problems"} to continue:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {errorList.slice(0, 6).map(([k, msg]) => (
                      <li key={k}>
                        <button type="button" className="text-left underline underline-offset-2" onClick={() => focusKey(k)}>
                          {msg}
                        </button>
                      </li>
                    ))}
                    {errorList.length > 6 && <li>and {errorList.length - 6} more.</li>}
                  </ul>
                </Banner>
              </div>
            )}

            {/* blur anywhere inside marks that field as visited, for inline validation */}
            <div
              onBlur={(e) => {
                const id = (e.target as HTMLElement).id;
                if (id) setTouched((t) => (t.has(id) ? t : new Set(t).add(id)));
              }}
            >
              {step === 0 && <StepSubmitter {...stepProps} submitter={submitter} lookup={lookup} />}
              {step === 1 && <StepSupplier {...stepProps} />}
              {step === 2 && <StepBill {...stepProps} />}
              {step === 3 && <StepItems {...stepProps} />}
              {step === 4 && <StepFunding {...stepProps} />}
              {step === 5 && (
                <StepReview
                  {...stepProps}
                  goTo={goTo}
                  lookup={lookup}
                  submitter={submitter}
                />
              )}
            </div>
          </div>

          <div className="hidden lg:block">
            <SummaryPanel f={f} lookup={lookup} variant="side" />
          </div>
        </div>
      </div>

      {/* mobile summary + sticky actions */}
      <div className="shrink-0 lg:hidden">
        <SummaryPanel f={f} lookup={lookup} variant="bar" />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        {confirmCancel ? (
          <div className="flex flex-wrap items-center justify-between gap-3" role="alertdialog" aria-label="Discard this bill?">
            <p className="text-sm text-slate-800">Discard this bill and its saved draft?</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
              <Button
                className="bg-red-700 text-white hover:bg-red-800"
                onClick={() => {
                  clearDraft(draftKey);
                  reset();
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="text"
              onClick={() => (hasContent ? setConfirmCancel(true) : reset())}
            >
              Cancel
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {step === LAST && route && canSubmit && (
                <span className="hidden text-xs text-slate-500 sm:inline">First stop: {route}</span>
              )}
              <Button variant="outline" onClick={persist} disabled={!hasContent}>
                Save Draft
              </Button>
              <Button variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0}>
                Back
              </Button>
              {step < LAST ? (
                <Button onClick={next}>Next</Button>
              ) : (
                <Button onClick={submit} disabled={!canSubmit} aria-describedby="submit-why">
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Submitting…
                    </>
                  ) : (
                    "Submit Bill"
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        {step === LAST && !canSubmit && !submitting && !confirmCancel && (
          <p id="submit-why" className="mt-2 text-right text-xs text-slate-500">
            Tick both confirmations and clear any problems above to submit.
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// Stepper: numbered on desktop, "Step 3 of 6" on mobile
// ---------------------------------------------------------------------

function Stepper({ step, reached, onGo }: { step: number; reached: number; onGo: (n: number) => void }) {
  return (
    <div className="sticky top-0 z-20 shrink-0 border-y border-slate-200 bg-white/95 py-3 backdrop-blur">
      <div className="sm:hidden">
        <p className="text-sm font-medium text-slate-900">
          Step {step + 1} of {STEPS.length} <span className="font-normal text-slate-500">· {STEPS[step].label}</span>
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-slate-200" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <ol className="hidden items-center sm:flex" aria-label="Progress">
        {STEPS.map((s, i) => {
          const current = i === step;
          const complete = i < reached && !current;
          const clickable = i <= reached && !current;
          return (
            <li key={s.id} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")} aria-current={current ? "step" : undefined}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onGo(i)}
                className={cn(
                  "flex items-center gap-2 rounded-md py-1 pr-2 text-sm",
                  clickable ? "cursor-pointer hover:bg-slate-100" : "cursor-default",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    current && "border-blue-700 bg-blue-700 text-white",
                    complete && !current && "border-green-600 bg-green-600 text-white",
                    !current && !complete && "border-slate-300 bg-white text-slate-500"
                  )}
                >
                  {complete && !current ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className={cn("hidden whitespace-nowrap md:inline", current ? "font-semibold text-slate-900" : "text-slate-600")}>
                  {s.label}
                </span>
                <span className="sr-only">{current ? " (current step)" : complete ? " (completed)" : ""}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn("mx-2 h-px flex-1", i < reached ? "bg-green-500" : "bg-slate-300")} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default UploadBill;
