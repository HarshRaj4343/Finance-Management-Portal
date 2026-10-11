/** Only same-origin relative paths; browsers treat backslashes as URL separators. */
export function safeCallbackPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return null;
  const url = new URL(value, "https://portal.invalid");
  return url.origin === "https://portal.invalid" ? url.pathname + url.search + url.hash : null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function isMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 1e10 && Number(value.toFixed(2)) === value;
}

export function pagination(params: URLSearchParams) {
  const limit = Number(params.get("limit") ?? 100);
  const offset = Number(params.get("offset") ?? 0);
  return {
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100,
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
  };
}
