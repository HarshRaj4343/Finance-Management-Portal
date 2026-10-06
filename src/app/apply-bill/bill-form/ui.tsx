"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------
// Shared look
// ---------------------------------------------------------------------

const control =
  "h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 " +
  "outline-none transition-shadow focus:border-blue-700 focus:ring-2 focus:ring-blue-700/25 " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

const border = (error?: string) => (error ? "border-red-600" : "border-slate-300");

export function Card({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6", className)}>
      {(title || action) && (
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Two columns on desktop, one on mobile. 24px between fields. */
export const Grid = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2", className)}>{children}</div>
);

export const Full = ({ children }: { children: React.ReactNode }) => (
  <div className="sm:col-span-2">{children}</div>
);

type ShellProps = {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  right?: React.ReactNode;
};

function Shell({ id, label, required, hint, error, right, children }: ShellProps & { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
        </label>
        {right}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1.5 flex items-start gap-1 text-xs font-medium text-red-700">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: React.ReactNode, error?: string) =>
  error ? `${id}-err` : hint ? `${id}-hint` : undefined;

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export function TextField({
  id,
  label,
  required,
  hint,
  error,
  right,
  value,
  onChange,
  onBlur,
  type = "text",
  ...rest
}: ShellProps & {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id">) {
  return (
    <Shell {...{ id, label, required, hint, error, right }}>
      <input
        {...rest}
        id={id}
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, border(error), rest.className)}
      />
    </Shell>
  );
}

/** Whole-number stepper-free input (qty etc.). Wheel never changes it. */
export function NumberField(props: Parameters<typeof TextField>[0]) {
  return (
    <TextField
      {...props}
      type="number"
      inputMode="numeric"
      min={props.min ?? 0}
      onWheel={(e) => e.currentTarget.blur()}
    />
  );
}

export function AreaField({
  id,
  label,
  required,
  hint,
  error,
  value,
  onChange,
  max,
  rows = 3,
}: ShellProps & { value: string; onChange: (v: string) => void; max?: number; rows?: number }) {
  return (
    <Shell
      {...{ id, label, required, hint, error }}
      right={max ? <span className="text-xs text-slate-500">{value.length}/{max}</span> : undefined}
    >
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "h-auto py-2 leading-relaxed", border(error))}
      />
    </Shell>
  );
}

/** Rupee input: raw digits while typing, Indian grouping once you leave it. */
export function MoneyField({
  id,
  label,
  required,
  hint,
  error,
  right,
  value,
  onChange,
  disabled,
}: ShellProps & { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [focused, setFocused] = useState(false);
  const num = Number(value.replace(/[₹,\s]/g, ""));
  const shown =
    !focused && value.trim() !== "" && Number.isFinite(num)
      ? num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : value;
  return (
    <Shell {...{ id, label, required, hint, error, right }}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500" aria-hidden="true">
          ₹
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={shown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.,]/g, "").replace(/,/g, "");
            if (/^\d*\.?\d{0,2}$/.test(v)) onChange(v);
          }}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(control, "pl-7 text-right tabular-nums", border(error))}
        />
      </div>
    </Shell>
  );
}

/** Grey, locked, with the source on hover and for screen readers. */
export function ReadOnlyField({
  id,
  label,
  value,
  source,
  hint,
  money,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  source: string;
  hint?: React.ReactNode;
  money?: boolean;
  multiline?: boolean;
}) {
  const empty = !value || value === "—";
  return (
    <Shell id={id} label={label} hint={hint}>
      <div
        id={id}
        role="textbox"
        aria-readonly="true"
        aria-label={`${label}, auto-filled from ${source}`}
        title={`Auto-filled from ${source}`}
        className={cn(
          "flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm",
          empty ? "text-slate-400" : "text-slate-800",
          money && "tabular-nums"
        )}
      >
        <span className={cn("min-w-0 flex-1", money && "text-right", multiline ? "whitespace-pre-line" : "truncate")}>
          {empty ? "—" : value}
        </span>
        <Lock className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      </div>
    </Shell>
  );
}

export type Option = { value: string; label?: string; group?: string };

/** Fewer than 8 options: Radix Select. */
export function SelectField({
  id,
  label,
  required,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled,
}: ShellProps & {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Shell {...{ id, label, required, hint, error }}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn("h-10 w-full bg-white", border(error))}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label ?? o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Shell>
  );
}

/**
 * 8 or more options (or a master that is still empty): searchable combobox.
 * `allowCustom` keeps typed text as the value, for masters that do not exist yet.
 */
export function ComboField({
  id,
  label,
  required,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder = "Search or select",
  disabled,
  allowCustom,
  emptyText = "No results.",
}: ShellProps & {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  emptyText?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected ? (selected.label ?? selected.value) : value;
  const shown = query ?? selectedLabel;

  const visible = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q || query === selectedLabel) return options;
    return options.filter((o) => `${o.value} ${o.label ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q));
  }, [options, query, selectedLabel]);

  useEffect(() => setActive(0), [query, open]);

  const choose = (o: Option) => {
    onChange(o.value);
    setQuery(null);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (visible[active]) choose(visible[active]);
      else {
        setOpen(false);
        setQuery(null);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery(null);
    }
  };

  let lastGroup: string | undefined;

  return (
    <Shell {...{ id, label, required, hint, error }}>
      <div
        ref={root}
        className="relative"
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
            setQuery(null);
          }
        }}
      >
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy(id, hint, error)}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={shown}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (allowCustom || e.target.value === "") onChange(e.target.value);
          }}
          onKeyDown={onKey}
          className={cn(control, "pr-9", border(error))}
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        {open && !disabled && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          >
            {visible.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <React.Fragment key={o.value}>
                  {header && (
                    <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {header}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 px-3 py-2",
                      i === active ? "bg-blue-50 text-blue-900" : "text-slate-800"
                    )}
                  >
                    <span>{o.label ?? o.value}</span>
                    {o.value === value && <Check className="size-4 text-blue-700" aria-hidden="true" />}
                  </li>
                </React.Fragment>
              );
            })}
            {visible.length === 0 && (
              <li role="presentation" className="px-3 py-2 text-slate-500">
                {allowCustom && shown.trim() ? `Press Enter to use “${shown.trim()}”.` : emptyText}
              </li>
            )}
          </ul>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------

export function Banner({
  tone,
  children,
  id,
}: {
  tone: "error" | "warning" | "success" | "info";
  children: React.ReactNode;
  id?: string;
}) {
  const t = {
    error: "border-red-300 bg-red-50 text-red-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    success: "border-green-300 bg-green-50 text-green-900",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <div id={id} className={cn("rounded-lg border px-4 py-3 text-sm", t)}>
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "text" | "danger" }) {
  const v = {
    primary:
      "bg-blue-700 text-white shadow-sm hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none",
    outline: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
    text: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400",
    danger: "text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed",
        v,
        className
      )}
    />
  );
}
