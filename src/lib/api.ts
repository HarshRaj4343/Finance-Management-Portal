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

export const money = (n: number | string | null | undefined) =>
  "₹" +
  Number(n ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const when = (ts: string | null | undefined) =>
  ts
    ? new Date(ts).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
