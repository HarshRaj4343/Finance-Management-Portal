// types.ts
// One definition of a bill, shared with the database types. The page-local
// copy that used to live here had drifted: it was missing bill_number,
// employee_department, the bank guarantee fields and the remarks columns,
// so every page that touched them had to cast through `any`.
export type { BillRow as Bill } from "@/types/database";
