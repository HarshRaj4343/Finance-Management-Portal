/**
 * The browser's way of talking to the portal.
 *
 * Every call returns { data } or { error }, never throws, and never leaks
 * a raw Postgres message: the API routes translate those into sentences
 * before they get here. Callers show `error` to the person and carry on.
 */

export type Result<T> = { data: T; error: null } | { data: null; error: string };

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const text = await res.text();
    const body = text ? JSON.parse(text) : {};

    if (!res.ok || body?.error) {
      return {
        data: null,
        error:
          body?.error ??
          (res.status === 401
            ? "Your session has expired. Please sign in again."
            : `The server returned ${res.status}.`),
      };
    }
    return { data: body as T, error: null };
  } catch {
    return {
      data: null,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}

export const api = {
  /** Follow keyset pages so an old pending bill is never hidden by a fixed cap. */
  bills: async <T extends { bills: unknown[] }>(url: string): Promise<Result<T>> => {
    const all: unknown[] = [];
    let cursor: string | null = null;
    let first: T | null = null;
    do {
      const target = new URL(url, "http://portal.invalid");
      target.searchParams.set("limit", "500");
      target.searchParams.delete("offset");
      if (cursor) target.searchParams.set("cursor", cursor);
      const result = await request<T & { nextCursor: string | null }>(target.pathname + target.search, { method: "GET", cache: "no-store" });
      if (result.error || !result.data) return { data: null, error: result.error ?? "Could not load all bills." };
      first ??= result.data;
      all.push(...result.data.bills);
      cursor = result.data.nextCursor;
    } while (cursor);
    return { data: { ...first!, bills: all } as T, error: null };
  },
  get: <T>(url: string) => request<T>(url, { method: "GET", cache: "no-store" }),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};

/** Builds a query string, leaving out anything empty. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** ₹1,25,000.00 -- every amount in the portal, Indian digit grouping. */
export const money = (n: number | string | null | undefined) =>
  "₹" +
  Number(n ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** 1,25,000 -- counts. */
export const count = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString("en-IN");

/**
 * Any timestamp the API returns: ISO, or Postgres text such as
 * "2026-10-14 21:04:00.12+05:30" / "...+00", which Safari cannot parse as is.
 * A bare YYYY-MM-DD is a calendar day, not an instant.
 */
export function parseTs(ts: string | Date | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? `${ts}T00:00:00+05:30` : ts.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 14 Oct 2026, 09:04 pm -- date and time, always in IST. */
export const when = (ts: string | Date | null | undefined) => {
  const d = parseTs(ts);
  return d
    ? d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
};

/** 14 Oct 2026 -- a calendar day, always in IST. */
export const dateOnly = (ts: string | Date | null | undefined) => {
  const d = parseTs(ts);
  return d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";
};
