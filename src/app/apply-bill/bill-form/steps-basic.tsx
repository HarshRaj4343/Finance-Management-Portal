"use client";

import React from "react";
import { Banner, Card, ComboField, Full, Grid, MoneyField, ReadOnlyField, SelectField, TextField, AreaField } from "./ui";
import { FormState, inr, shortDate, todayISO, totals } from "./model";
import { PURCHASE_TYPES, SUPPLIERS } from "./masters";

export type StepProps = {
  f: FormState;
  set: (patch: Partial<FormState>) => void;
  errors: Record<string, string>;
};

export type Lookup = {
  state: "idle" | "looking" | "found" | "missing";
  code?: string;
  name?: string;
  department?: string | null;
  message?: string | null;
};

// ---------------------------------------------------------------------
// Step 1 — Submitter
// ---------------------------------------------------------------------

export function StepSubmitter({ f, set, errors, lookup }: StepProps & { lookup: Lookup }) {
  return (
    <Card title="Submitter" description="Enter the employee ID or student enrolment number associated with this bill.">
      <Grid>
        <TextField
          id="f-requester"
          label="Employee ID / Student Enrolment"
          required
          value={f.requesterCode}
          onChange={(v) => set({ requesterCode: v.toUpperCase(), requesterName: "" })}
          error={errors["f-requester"]}
          hint={lookup.state === "looking" ? "Looking up…" : "IDs are matched without regard to letter case."}
          autoComplete="off"
          placeholder="e.g. E001 or B24101"
        />
        <ReadOnlyField id="f-requester-name" label="Name" value={lookup.state === "found" ? lookup.name ?? "" : ""} source="the employee directory" />
        <ReadOnlyField id="f-requester-dept" label="Department / Section" value={lookup.state === "found" ? lookup.department ?? "" : ""} source="the employee directory" />
        <ReadOnlyField id="f-sub-date" label="Submission Date" value={shortDate(todayISO())} source="today’s date" />
      </Grid>
      {lookup.state === "missing" && lookup.message && !errors["f-requester"] && (
        <div className="mt-5"><Banner tone="warning">{lookup.message}</Banner></div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Step 2 — Purchase Order and Supplier
// ---------------------------------------------------------------------

export function StepSupplier({ f, set, errors }: StepProps) {
  const isPo = f.purchaseType === "po";
  return (
    <div className="space-y-8">
      <Card title="Purchase Order" description="How was this purchase made?">
        <Grid>
          <SelectField
            id="f-purchase-type"
            label="Purchase Type"
            required
            value={f.purchaseType}
            onChange={(v) => set({ purchaseType: v as FormState["purchaseType"] })}
            options={PURCHASE_TYPES.map((p) => ({ value: p.value, label: p.label }))}
            placeholder="Select purchase type"
            error={errors["f-purchase-type"]}
          />
          {isPo && (
            <ComboField
              id="f-po-number"
              label="PO Number"
              required
              value={f.poNumber}
              onChange={(v) => set({ poNumber: v })}
              options={[]}
              allowCustom
              placeholder="Enter PO number"
              emptyText="The PO register is not connected yet. Type the PO number."
              error={errors["f-po-number"]}
              hint="Type the number as printed on the PO."
            />
          )}
          {isPo && (
            <TextField
              id="f-po-date"
              label="PO Date"
              required
              type="date"
              max={todayISO()}
              value={f.poDate}
              onChange={(v) => set({ poDate: v })}
              error={errors["f-po-date"]}
              hint={f.poDate ? shortDate(f.poDate) : undefined}
            />
          )}
          {f.purchaseType && (
            <MoneyField
              id="f-po-value"
              label={isPo ? "PO Value (₹)" : "Purchase Value (₹)"}
              required
              value={f.poValue}
              onChange={(v) => set({ poValue: v })}
              error={errors["f-po-value"]}
              hint={isPo ? "Fills automatically once the PO register is connected." : undefined}
            />
          )}
        </Grid>
      </Card>

      <Card title="Supplier" description="Who issued the bill?">
        <Grid>
          <ComboField
            id="f-supplier"
            label="Supplier Name"
            required
            value={f.supplierName}
            onChange={(v) => {
              // Picking a listed supplier fills the address; a typed name leaves them alone.
              const s = SUPPLIERS.find((x) => x.name === v);
              set(s ? { supplierName: v, supplierAddress: s.address } : { supplierName: v });
            }}
            options={SUPPLIERS.map((s) => ({ value: s.name }))}
            allowCustom
            placeholder="Search or type a supplier"
            emptyText="Not in the list. Press Enter to use the name you typed."
            hint="Choosing a listed supplier fills in the address."
            error={errors["f-supplier"]}
          />
          <Full>
            <AreaField
              id="f-address"
              label="Supplier Address"
              required
              value={f.supplierAddress}
              onChange={(v) => set({ supplierAddress: v })}
              rows={2}
              error={errors["f-address"]}
            />
          </Full>
        </Grid>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Step 3 — Bill
// ---------------------------------------------------------------------

export function StepBill({ f, set, errors }: StepProps) {
  const T = totals(f);

  return (
    <div className="space-y-8">
      <Card title="Bill Details" description="Copy these from the supplier's invoice.">
        <Grid>
          <TextField
            id="f-bill-no"
            label="Bill / Invoice Number"
            required
            value={f.billNo}
            onChange={(v) => set({ billNo: v })}
            maxLength={50}
            error={errors["f-bill-no"]}
          />
          <TextField
            id="f-bill-date"
            label="Bill Date"
            required
            type="date"
            max={todayISO()}
            min={f.purchaseType === "po" && f.poDate ? f.poDate : undefined}
            value={f.billDate}
            onChange={(v) => set({ billDate: v })}
            error={errors["f-bill-date"]}
            hint={f.billDate ? shortDate(f.billDate) : undefined}
          />
        </Grid>
      </Card>

      <Card
        title="Other Charges"
        description="The bill total is calculated from item quantities and unit prices in the next step."
      >
        <Grid>
          <MoneyField
            id="f-other"
            label="Other Charges (₹)"
            value={f.otherCharges}
            onChange={(v) => set({ otherCharges: v })}
            error={errors["f-other"]}
            hint="Freight, packing and similar."
          />
          <Full>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">Total Bill Amount</span>
              <span className="text-lg font-semibold tabular-nums text-slate-900" aria-live="polite">
                {T.total > 0 ? inr(T.total) : "—"}
              </span>
            </div>
          </Full>
        </Grid>
      </Card>

      <Card
        title="Delivery and Installation"
        description="A bill is raised only after the goods have arrived and, where needed, been installed."
      >
        <Grid>
          <SelectField
            id="f-delivered"
            label="Goods Delivered?"
            required
            value={f.delivered}
            onChange={(v) => set({ delivered: v as FormState["delivered"], ...(v !== "yes" ? { deliveryDate: "" } : {}) })}
            options={YES_NO}
            error={errors["f-delivered"]}
          />
          {f.delivered === "yes" && (
            <TextField
              id="f-delivery-date"
              label="Delivery Date"
              required
              type="date"
              max={todayISO()}
              value={f.deliveryDate}
              onChange={(v) => set({ deliveryDate: v })}
              error={errors["f-delivery-date"]}
              hint={f.deliveryDate ? shortDate(f.deliveryDate) : undefined}
            />
          )}
          <SelectField
            id="f-install-required"
            label="Installation Required?"
            required
            value={f.installRequired}
            onChange={(v) =>
              set({ installRequired: v as FormState["installRequired"], ...(v !== "yes" ? { installDone: "", installDate: "" } : {}) })
            }
            options={YES_NO}
            error={errors["f-install-required"]}
          />
          {f.installRequired === "yes" && (
            <SelectField
              id="f-install-done"
              label="Installation Completed?"
              required
              value={f.installDone}
              onChange={(v) => set({ installDone: v as FormState["installDone"], ...(v !== "yes" ? { installDate: "" } : {}) })}
              options={YES_NO}
              error={errors["f-install-done"]}
            />
          )}
          {f.installRequired === "yes" && f.installDone === "yes" && (
            <TextField
              id="f-install-date"
              label="Installation Date"
              required
              type="date"
              max={todayISO()}
              min={f.deliveryDate || undefined}
              value={f.installDate}
              onChange={(v) => set({ installDate: v })}
              error={errors["f-install-date"]}
              hint={f.installDate ? shortDate(f.installDate) : undefined}
            />
          )}
        </Grid>
        {errors["f-delivery-block"] && (
          <div className="mt-5">
            <Banner id="f-delivery-block" tone="warning">{errors["f-delivery-block"]}</Banner>
          </div>
        )}
      </Card>

      <Card title="Remarks">
        <AreaField
          id="f-remarks"
          label="Remarks"
          value={f.remarks}
          onChange={(v) => set({ remarks: v })}
          max={500}
          error={errors["f-remarks"]}
        />
      </Card>
    </div>
  );
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
