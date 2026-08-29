// types.ts
// One definition of a bill, shared with the database types. The page-local
// copy that used to live here had drifted: it was missing bill_number,
// employee_department, the bank guarantee fields and the remarks columns,
// so every page that touched them had to cast through `any`.
export type { BillRow as Bill } from "@/types/database";

export interface BillFormData {
  employee_id: string;
  employee_name: string;
  po_details: string;
  po_value: string;
  supplier_name: string;
  supplier_address: string;
  item_category: string;
  item_description: string;
  qty: string;
  bill_details: string;
  indenter_name: string;
  qty_issued: string;
  source_of_fund: string;
  stock_entry: string;
  location: string;
}