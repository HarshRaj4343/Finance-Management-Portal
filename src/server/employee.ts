import "server-only";
import { query } from "./db";
import { HttpError } from "./session";
import type { EmployeeRow } from "@/types/database";

/** Resolve an entered ID without changing the canonical code used by foreign keys. */
export async function findEmployee(code: string): Promise<EmployeeRow | null> {
  const matches = await query<EmployeeRow>(
    "select * from public.employees where upper(employee_code) = upper($1) limit 2",
    [code.trim()]
  );
  if (matches.length > 1) {
    throw new HttpError(409, "More than one employee has this ID. Ask the Dean’s office to correct the directory.");
  }
  return matches[0] ?? null;
}
