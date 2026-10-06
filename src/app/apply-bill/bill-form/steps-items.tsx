"use client";

import React, { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { AreaField, Banner, Button, Card, ComboField, Full, Grid, MoneyField, NumberField, ReadOnlyField, SelectField, TextField } from "./ui";
import {
  BRANDS, BUILDINGS, CONDITIONS, FLOORS, FUNDS, ITEM_CATEGORIES, ITEM_GROUPS, SPEC_PROFILES, UOMS, WARRANTY_MONTHS,
  findType, typesForGroup,
} from "./masters";
import { FormState, Line, Place, Unit, emptyLine, emptyUnit, inr, isAssetLine, lineQty, lineTotal, toNum, totals } from "./model";
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

/** Keep the unit rows in step with qty and item type. */
function syncUnits(l: Line): Line {
  const type = findType(l.group, l.type);
  if (!type?.assetTracking) return { ...l, units: [] };
  const n = lineQty(l);
  const units = l.units.slice(0, n);
  while (units.length < n) units.push(emptyUnit({ make: l.brand, model: l.model }));
  return { ...l, units };
}

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
      // Units that still carry the old make/model follow the line.
      if (patch.brand !== undefined || patch.model !== undefined) {
        next.units = next.units.map((u) => ({
          ...u,
          make: u.make === l.brand ? next.brand : u.make,
          model: u.model === l.model ? next.model : u.model,
        }));
      }
      if (!next.descriptionEdited && !("description" in patch)) next.description = suggest(next);
      if ("description" in patch) next.descriptionEdited = true;
      return syncUnits(next);
    });
    set({ lines });
  };

  const patchUnit = (i: number, j: number, patch: Partial<Unit>) =>
    set({
      lines: f.lines.map((l, k) =>
        k === i ? { ...l, units: l.units.map((u, m) => (m === j ? { ...u, ...patch } : u)) } : l
      ),
    });

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
          onUnit={(j, p) => patchUnit(i, j, p)}
          onUnits={(units) => patchLine(i, { units })}
          onRemove={() => set({ lines: f.lines.filter((_, k) => k !== i) })}
        />
      ))}

      <div>
        <Button variant="outline" onClick={() => set({ lines: [...f.lines, emptyLine()] })}>
          <Plus className="size-4" aria-hidden="true" /> Add another item
        </Button>
      </div>

      {errors["f-items-sum"] && <Banner tone="error">{errors["f-items-sum"]}</Banner>}

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
  i, l, errors, canRemove, onPatch, onUnit, onUnits, onRemove,
}: {
  i: number;
  l: Line;
  errors: Record<string, string>;
  canRemove: boolean;
  onPatch: (p: Partial<Line>) => void;
  onUnit: (j: number, p: Partial<Unit>) => void;
  onUnits: (u: Unit[]) => void;
  onRemove: () => void;
}) {
  const id = (k: string) => `line-${i}-${k}`;
  const type = findType(l.group, l.type);
  const types = typesForGroup(l.group);
  const asset = isAssetLine(l);

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
          required={asset}
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
          required={asset}
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

      {asset && type && (
        <UnitRows i={i} l={l} serial={type.serial} spec={type.spec} errors={errors} onUnit={onUnit} onUnits={onUnits} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Asset rows: one per unit
// ---------------------------------------------------------------------

function UnitRows({
  i, l, serial, spec, errors, onUnit, onUnits,
}: {
  i: number;
  l: Line;
  serial: boolean;
  spec?: string;
  errors: Record<string, string>;
  onUnit: (j: number, p: Partial<Unit>) => void;
  onUnits: (u: Unit[]) => void;
}) {
  const [paste, setPaste] = useState("");
  const specFields = spec ? SPEC_PROFILES[spec] ?? [] : [];
  const n = l.units.length;
  if (n === 0) return null;

  const applyPaste = () => {
    const serials = paste.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
    onUnits(l.units.map((u, j) => (serials[j] ? { ...u, serial: serials[j] } : u)));
    setPaste("");
  };

  const copyFirst = () => {
    const [first, ...rest] = l.units;
    onUnits([first, ...rest.map((u) => ({ ...u, ...first, serial: u.serial }))]);
  };

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Asset details · {n} unit{n === 1 ? "" : "s"}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            This item is tracked as an asset, so each unit needs its own details and where it is placed.
          </p>
        </div>
        {n > 1 && (
          <Button variant="outline" className="h-8 text-xs" onClick={copyFirst}>
            <Copy className="size-3.5" aria-hidden="true" /> Copy Unit 1 details to all
          </Button>
        )}
      </div>

      {serial && n > 1 && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label htmlFor={`line-${i}-paste`} className="mb-1.5 block text-sm font-medium text-slate-800">
            Paste serial numbers
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              id={`line-${i}-paste`}
              rows={2}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="One per line, in unit order"
              className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/25"
            />
            <Button variant="outline" disabled={!paste.trim()} onClick={applyPaste} className="shrink-0 sm:self-start">
              Fill serials
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {l.units.map((u, j) => {
          const uid = (k: string) => `line-${i}-unit-${j}-${k}`;
          return (
            <div key={j} className="rounded-lg border border-slate-200 p-4">
              <p className="mb-4 text-sm font-semibold text-slate-800">Unit {j + 1}</p>
              <Grid>
                <ComboField
                  id={uid("make")}
                  label="Make / Brand"
                  required
                  value={u.make}
                  onChange={(v) => onUnit(j, { make: v })}
                  options={BRANDS.map((b) => ({ value: b }))}
                  allowCustom
                  error={errors[uid("make")]}
                />
                <TextField
                  id={uid("model")}
                  label="Model"
                  required
                  value={u.model}
                  onChange={(v) => onUnit(j, { model: v })}
                  error={errors[uid("model")]}
                />
                {serial && (
                  <TextField
                    id={uid("serial")}
                    label="Serial Number"
                    required
                    value={u.serial}
                    onChange={(v) => onUnit(j, { serial: v })}
                    error={errors[uid("serial")]}
                    autoComplete="off"
                  />
                )}
                <ReadOnlyField id={uid("tag")} label="Asset Tag / ID" value="Generated on submission" source="the asset register" />
                {specFields.map((sf) =>
                  sf.options ? (
                    <SelectField
                      key={sf.key}
                      id={uid(`spec-${sf.key}`)}
                      label={sf.label}
                      value={u.specs[sf.key] ?? ""}
                      onChange={(v) => onUnit(j, { specs: { ...u.specs, [sf.key]: v } })}
                      options={sf.options.map((o) => ({ value: o }))}
                    />
                  ) : (
                    <TextField
                      key={sf.key}
                      id={uid(`spec-${sf.key}`)}
                      label={sf.label}
                      value={u.specs[sf.key] ?? ""}
                      onChange={(v) => onUnit(j, { specs: { ...u.specs, [sf.key]: v } })}
                    />
                  )
                )}
                <SelectField
                  id={uid("warranty")}
                  label="Warranty (months)"
                  required
                  value={u.warranty}
                  onChange={(v) => onUnit(j, { warranty: v })}
                  options={WARRANTY_MONTHS.map((w) => ({ value: w, label: w === "0" ? "No warranty" : `${w} months` }))}
                  error={errors[uid("warranty")]}
                />
                <SelectField
                  id={uid("condition")}
                  label="Condition at Receipt"
                  required
                  value={u.condition}
                  onChange={(v) => onUnit(j, { condition: v })}
                  options={CONDITIONS.map((c) => ({ value: c }))}
                  error={errors[uid("condition")]}
                  hint={u.condition === "Damaged" ? "Stores will be alerted about damaged items." : undefined}
                />
                <TextField
                  id={uid("custodian")}
                  label="Custodian"
                  required={l.group === "Computer & IT"}
                  value={u.custodian}
                  onChange={(v) => onUnit(j, { custodian: v })}
                  error={errors[uid("custodian")]}
                  hint="Employee ID or name of the person responsible for this item."
                />
                <Full>
                  <LocationFields
                    idPrefix={`line-${i}-unit-${j}`}
                    label="Installed / Placed At"
                    value={u}
                    onChange={(p) => onUnit(j, p)}
                    error={errors[uid("room")]}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Leave blank to use the default location chosen in the Funding and Stock step.
                  </p>
                </Full>
              </Grid>
            </div>
          );
        })}
      </div>
    </div>
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
                id={id("stock-page")}
                label="Stock Register Page No."
                required
                inputMode="numeric"
                value={l.stockPage}
                onChange={(v) => patchLine(i, { stockPage: v })}
                error={errors[id("stock-page")]}
                hint={l.group ? `Page for ${l.group} in the stock register.` : undefined}
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
                  label={isAssetLine(l) ? "Default Location" : "Location"}
                  required
                  value={l}
                  onChange={(p) => patchLine(i, p)}
                  error={errors[id("room")]}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  {isAssetLine(l)
                    ? "Used for every unit that has no placement of its own."
                    : "Where this batch is kept."}
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
