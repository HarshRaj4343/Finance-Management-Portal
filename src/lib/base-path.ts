/**
 * The URL prefix the portal is served under.
 *
 * At the institute the portal sits behind Apache at
 * https://cas.iitmandi.ac.in/finance, so every page, asset and API call
 * lives under "/finance". Locally it runs at the root. The prefix is set
 * at build time with NEXT_PUBLIC_BASE_PATH (next.config.ts reads the same
 * variable for Next's basePath).
 *
 * Next adds the prefix by itself to <Link>, router.push and redirect().
 * Everything else that names a path -- fetch, window.location, window.open,
 * plain <a href>, <Image src> for files in public/, NextAuth callback URLs
 * -- must go through withBase().
 *
 * Safe to import from client components.
 */

function normalise(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

/** "" at the root, otherwise e.g. "/finance" (no trailing slash). */
export const BASE_PATH = normalise(process.env.NEXT_PUBLIC_BASE_PATH);

/** "/login" -> "/finance/login". Absolute URLs and already-prefixed paths are left alone. */
export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) return path;
  return `${BASE_PATH}${path}`;
}

/** "/finance/bill/1" -> "/bill/1": a browser path back to the app's own path. */
export function stripBase(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  if (path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) {
    const rest = path.slice(BASE_PATH.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return path;
}
