"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { AreaField, Button, Card, ComboField, Full, Grid, MoneyField, NumberField, ReadOnlyField, SelectField, TextField } from "./ui";
import {
  BRANDS, BUILDINGS, FLOORS, FUNDS, ITEM_CATEGORIES, ITEM_GROUPS, UOMS,
  findType, typesForGroup,
} from "./masters";
import { FormState, Line, Place, emptyLine, inr, needsMakeModel, lineQty, lineTotal, toNum, totals } from "./model";
import type { StepProps } from "./steps-basic";

// ---------------------------------------------------------------------
// Cascading location: Building → Floor → Room
// ---------------------------------------------------------------------

/**
 * A child stays disabled until its parent is chosen, and changing a parent
 * clears the children. The error is attached to whichever field still
 * needs filling, so "focus the first error" lands in the right place.
 */
export function LocationFields({
  idPrefix,
  value,
  onChange,
  error,
  required,
  label = "Location",
}: {
  idPrefix: string;
  value: Place;
  onChange: (p: Place) => void;
  error?: string;
  required?: boolean;
  label?: string;
}) {
  const errId = `${idPrefix}-room`;
  const target = !value.building ? "building" : !value.floor ? "floor" : "room";
  const idFor = (k: "building" | "floor" | "room") => (error && target === k ? errId : `${idPrefix}-${k}`);
  const errFor = (k: "building" | "floor" | "room") => (error && target === k ? error : undefined);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ComboField
          id={idFor("building")}
          label="Building"
          required={required}
          value={value.building}
          onChange={(v) => onChange({ building: v, floor: "", room: "" })}
          options={BUILDINGS.map((b) => ({ value: b }))}
          allowCustom
          placeholder="Building / block"
          emptyText="Type the building name."
          error={errFor("building")}
        />
        <ComboField
          id={idFor("floor")}
          label="Floor"
          required={required}
          value={value.floor}
          onChange={(v) => onChange({ ...value, floor: v, room: "" })}
          options={FLOORS.map((x) => ({ value: x }))}
          allowCustom
          disabled={!value.building}
          placeholder={value.building ? "Floor" : "Choose building first"}
          error={errFor("floor")}
        />
        <ComboField
          id={idFor("room")}
          label="Room / Lab"
          required={required}
          value={value.room}
          onChange={(v) => onChange({ ...value, room: v })}
          options={[]}
          allowCustom
          disabled={!value.floor}
          placeholder={value.floor ? "Room, lab or office" : "Choose floor first"}
          emptyText="Type the room or lab."
          error={errFor("room")}
        />
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------
// Step 4 — Items
// ---------------------------------------------------------------------

const suggest = (l: Line) => [l.type, l.brand, l.model].map((s) => s.trim()).filter(Boolean).join(" ");

export function StepItems({ f, set, errors }: StepProps) {
  const T = totals(f);

  const patchLine = (i: number, patch: Partial<Line>) => {
    const lines = f.lines.map((l, k) => {
      if (k !== i) return l;
      let next: Line = { ...l, ...patch };

      if ("group" in patch && patch.group !== l.group) {
        next = { ...next, type: "", brand: "", model: "", description: "", descriptionEdited: false, uom: "Nos" };
      }
      if ("type" in patch && patch.type !== l.type) {
        const t = findType(next.group, next.type);
        next = { ...next, uom: t?.uom ?? next.uom, descriptionEdited: false };
      }
      if (!next.descriptionEdited && !("description" in patch)) next.description = suggest(next);
      if ("description" in patch) next.descriptionEdited = true;
      return next;
    });
    set({ lines });
  };

  return (
    <div className="space-y-8">
      <Card title="Item Category">
        <Grid>
          <SelectField
            id="f-category"
            label="Item Category"
            required
            value={f.category}
            onChange={(v) => set({ category: v })}
            options={ITEM_CATEGORIES.map((c) => ({ value: c }))}
            error={errors["f-category"]}
            hint="Applies to every item on this bill. It decides which desk sees the bill first."
          />
        </Grid>
      </Card>

      {f.lines.map((l, i) => (
        <LineCard
          key={l.key}
          i={i}
          l={l}
          errors={errors}
          canRemove={f.lines.length > 1}
          onPatch={(p) => patchLine(i, p)}
          onRemove={() => set({ lines: f.lines.filter((_, k) => k !== i) })}
        />
      ))}

      <div>
        <Button variant="outline" onClick={() => set({ lines: [...f.lines, emptyLine()] })}>
          <Plus className="size-4" aria-hidden="true" /> Add another item
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-slate-600">
          {f.lines.length} item line{f.lines.length === 1 ? "" : "s"} · {T.units} unit{T.units === 1 ? "" : "s"}
        </span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">Items total {inr(T.itemsSum)}</span>
      </div>
    </div>
  );
}

function LineCard({
  i, l, errors, canRemove, onPatch, onRemove,
}: {
  i: number;
  l: Line;
  errors: Record<string, string>;
  canRemove: boolean;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const id = (k: string) => `line-${i}-${k}`;
  const type = findType(l.group, l.type);
  const types = typesForGroup(l.group);
  const requiresMakeModel = needsMakeModel(l);

  return (
    <Card
      title={`Item ${i + 1}`}
      action={
        canRemove ? (
          <Button variant="danger" className="h-8 px-2 text-xs" onClick={onRemove}>
            <Trash2 className="size-3.5" aria-hidden="true" /> Remove
          </Button>
        ) : undefined
      }
    >
      <Grid>
        <SelectField
          id={id("group")}
          label="Item Group"
          required
          value={l.group}
          onChange={(v) => onPatch({ group: v })}
          options={ITEM_GROUPS.map((g) => ({ value: g }))}
          placeholder="Select item group"
          error={errors[id("group")]}
        />
        <ComboField
          id={id("type")}
          label="Item Type"
          required
          value={l.type}
          onChange={(v) => onPatch({ type: v })}
          options={types.map((t) => ({ value: t.name }))}
          disabled={!l.group}
          placeholder={l.group ? "Search item type" : "Choose item group first"}
          emptyText={
            l.group && types.length === 0
              ? "Stores has not listed any types in this group yet."
              : "No results."
          }
          error={errors[id("type")]}
        />
        <ComboField
          id={id("brand")}
          label="Make / Brand"
          required={requiresMakeModel}
          value={l.brand}
          onChange={(v) => onPatch({ brand: v })}
          options={BRANDS.map((b) => ({ value: b }))}
          allowCustom
          placeholder="Select or type a brand"
          error={errors[id("brand")]}
        />
        <TextField
          id={id("model")}
          label="Model Name / No."
          required={requiresMakeModel}
          value={l.model}
          onChange={(v) => onPatch({ model: v })}
          maxLength={100}
          error={errors[id("model")]}
        />
        <Full>
          <AreaField
            id={id("description")}
            label="Item Description"
            required
            value={l.description}
            onChange={(v) => onPatch({ description: v })}
            max={200}
            rows={2}
            error={errors[id("description")]}
            hint="Suggested from type, make and model. Add short specifications."
          />
        </Full>
        <NumberField
          id={id("qty")}
          label="Quantity"
          required
          min={1}
          max={999}
          step={1}
          value={l.qty}
          onChange={(v) => onPatch({ qty: v })}
          error={errors[id("qty")]}
        />
        <ComboField
          id={id("uom")}
          label="Unit of Measure"
          required
          value={l.uom}
          onChange={(v) => onPatch({ uom: v })}
          options={UOMS.map((u) => ({ value: u }))}
          error={errors[id("uom")]}
          hint={type ? `Default for ${type.name}: ${type.uom}.` : undefined}
        />
        <MoneyField
          id={id("price")}
          label="Unit Price (₹)"
          required
          value={l.unitPrice}
          onChange={(v) => onPatch({ unitPrice: v })}
          error={errors[id("price")]}
        />
        <ReadOnlyField
          id={id("total")}
          label="Line Total (₹)"
          money
          value={lineTotal(l) > 0 ? inr(lineTotal(l)) : ""}
          source="quantity × unit price"
        />
      </Grid>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Step 5 — Funding and Stock
// ---------------------------------------------------------------------

export function StepFunding({ f, set, errors }: StepProps) {
  const T = totals(f);
  const fund = FUNDS.find((x) => x.code === f.fund);

  const patchLine = (i: number, patch: Partial<Line>) =>
    set({ lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  return (
    <div className="space-y-8">
      <Card title="Source of Fund">
        <Grid>
          <ComboField
            id="f-fund"
            label="Source of Fund"
            required
            value={f.fund}
            onChange={(v) => set({ fund: v })}
            options={FUNDS.map((x) => ({ value: x.code, label: `${x.code} — ${x.description}`, group: x.group }))}
            placeholder="Search by code or description"
            error={errors["f-fund"]}
            hint={fund ? `Charged to ${fund.code} — ${fund.description}.` : "Codes follow the OH-xx format."}
          />
        </Grid>
      </Card>

      {f.lines.map((l, i) => {
        const id = (k: string) => `line-${i}-${k}`;
        const issued = toNum(l.qtyIssued);
        const balance = Number.isFinite(issued) ? lineQty(l) - issued : NaN;
        return (
          <Card
            key={l.key}
            title={`Stock and Issue · Item ${i + 1}`}
            description={`${lineQty(l)} ${l.uom} ${l.type || "item"}`}
          >
            <Grid>
              <ReadOnlyField
                id={id("stock-entry")}
                label="Stock Entry No."
                value="Generated on submission"
                source="the stock register"
              />
              <TextField
                id={id("custodian")}
                label="Custodian"
                required
                value={l.custodian}
                onChange={(v) => patchLine(i, { custodian: v })}
                error={errors[id("custodian")]}
                hint="Employee ID or name of the person responsible for this item."
              />
              <NumberField
                id={id("qty-issued")}
                label="Qty Issued"
                required
                min={0}
                max={lineQty(l)}
                step={1}
                value={l.qtyIssued}
                onChange={(v) => patchLine(i, { qtyIssued: v })}
                error={errors[id("qty-issued")]}
              />
              <ReadOnlyField
                id={id("stock-balance")}
                label="Stock Balance"
                value={Number.isFinite(balance) && balance >= 0 ? String(balance) : ""}
                source="quantity minus quantity issued"
              />
              <Full>
                <LocationFields
                  idPrefix={`line-${i}`}
                  label="Placed At"
                  required
                  value={l}
                  onChange={(p) => patchLine(i, p)}
                  error={errors[id("room")]}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Where this item or batch is placed.
                </p>
              </Full>
            </Grid>
          </Card>
        );
      })}

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-slate-600">{T.units} units · {T.issued} issued</span>
        <span className="text-sm font-semibold tabular-nums">Bill total {inr(T.total)}</span>
      </div>
    </div>
  );
}

export type { FormState };
