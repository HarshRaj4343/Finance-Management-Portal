import "server-only";
import { Pool, types, type QueryResultRow } from "pg";

/**
 * The Postgres connection pool.
 *
 * Every read and write in the portal goes through an API route, and every
 * API route goes through here. Nothing in the browser holds database
 * credentials. Importing "server-only" at the top makes pulling this into
 * a client component a build error rather than a leak.
 *
 * State changes to bills and PDA accounts go through the workflow
 * functions in db/migrations/0002_functions.sql, which run in a single
 * transaction each.
 */

// node-postgres hands back numeric and bigint as strings, to avoid losing
// precision. Amounts here are numeric(12,2) and counts are small, so plain
// numbers are safe -- and the pages do arithmetic on them.
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));
types.setTypeParser(types.builtins.INT8, (v) => Number(v));
// A `date` column is a calendar day, not an instant. Parsing it into a JS
// Date would shift it by the server's UTC offset.
types.setTypeParser(types.builtins.DATE, (v) => v);

// Next's dev server re-evaluates modules on every change; keep one pool
// across reloads instead of leaking a new one each time.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

function pool(): Pool {
  if (globalForPg.pgPool) return globalForPg.pgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "The database is not configured. Set DATABASE_URL, e.g. " +
        "postgres://user:password@localhost:5432/ifmp"
    );
  }

  // pg parses this with the WHATWG URL parser, which rejects a password
  // containing "/" -- and reports only "Invalid URL", with no mention of
  // the database, so every query fails with nothing pointing at the cause.
  // (A generated base64 password did exactly this to a live deployment.)
  try {
    new URL(connectionString);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid connection URL. A password containing " +
        "'/', '@', ':' or '#' has to be percent-encoded, or the database " +
        "password changed to one without them."
    );
  }

  const p = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
  p.on("error", (err) => console.error("[db] idle client error", err.message));

  globalForPg.pgPool = p;
  return p;
}

/** All rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await pool().query<T>(sql, params);
  return rows;
}

/** The first row, or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const { rows } = await pool().query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Collects the parameters for a query assembled from optional filters.
 *
 *   const p = new Params();
 *   where.push(`status = ${p.add(status)}`);
 *   await query(`select ... where ${where.join(" and ")}`, p.values);
 */
export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Builds `where a and b`, or nothing when there are no conditions. */
export function whereClause(conditions: string[]): string {
  return conditions.length ? `where ${conditions.join(" and ")}` : "";
}

/** A search term made safe for ILIKE: wildcards the person typed are literal. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
