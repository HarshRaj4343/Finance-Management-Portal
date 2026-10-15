import "server-only";

export type CsvColumn<T> = [header: string, value: (row: T) => unknown];

/** Largest export in one file; registers are far smaller than this in practice. */
export const CSV_ROW_LIMIT = 50_000;

/**
 * One spreadsheet cell. Text that a spreadsheet would treat as a formula
 * (=, +, -, @, tab, carriage return) is prefixed with a quote so that an
 * entry typed into a bill can never execute when the export is opened.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map(([h]) => cell(h)).join(",")];
  for (const row of rows) lines.push(columns.map(([, get]) => cell(get(row))).join(","));
  // The byte-order mark makes Excel read the file as UTF-8 (₹, Hindi names).
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Timestamps in exports: IST, sortable, readable in Excel. */
export function istStamp(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * The columns the person ticked in the download dialog (?col=Header,
 * repeatable), kept in the file's own order. No ?col means every column.
 */
export function pickColumns<T>(columns: CsvColumn<T>[], params: URLSearchParams): CsvColumn<T>[] {
  const wanted = params.getAll("col");
  if (!wanted.length) return columns;
  const picked = columns.filter(([header]) => wanted.includes(header));
  if (!picked.length) throw Object.assign(new Error("Choose at least one column to download."), { status: 400 });
  return picked;
}

/** ?format=columns: the headers an export offers, for the download dialog. */
export function columnsResponse<T>(columns: CsvColumn<T>[]): Response {
  return Response.json({ columns: columns.map(([header]) => header) }, { headers: { "Cache-Control": "no-store" } });
}

/** A YYYY-MM-DD filter value, or a 400 for anything else. */
export function isoDay(value: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw Object.assign(new Error("Dates must be YYYY-MM-DD."), { status: 400 });
  }
  return value;
}
