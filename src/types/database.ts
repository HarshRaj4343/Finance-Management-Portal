/**
 * Database types, matching db/migrations/0001_schema.sql.
 *
 * Hand-maintained. If you change the schema, change this too.
 *
 * The previous version of this file described a schema that no longer
 * existed, which is why so much of the app was typed as `never` and had to
 * be cast with `as any` to compile.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type EmployeeType =
  | "User"
  | "Bill Employee"
  | "Bill Editor"
  | "Student Purchase"
  | "Audit"
  | "Finance Admin"
  | "PDA Manager"
  | "Dean";

export type BillStatus =
  | "User"
  | "Student Purchase"
  | "Audit"
  | "Finance Admin"
  | "Accepted"
  | "Rejected";

export type DeskState = "Pending" | "Hold" | "Reject" | "Approved";
export type ItemCategory = "Major" | "Minor" | "Consumables";

export interface EmployeeRow {
  id: string;
  employee_code: string;
  employee_name: string;
  email: string;
  department: string;
  employee_type: EmployeeType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PdaBalanceRow {
  id: string;
  employee_id: string;
  email: string;
  department: string;
  /** total granted */
  allocated: number;
  /** free to commit to a new bill */
  balance: number;
  /** reserved by bills still in the workflow */
  committed: number;
  /** finally approved and gone */
  spent: number;
  updated_at: string;
}

export interface BillRow {
  id: string;
  bill_number: string | null;

  employee_id: string;
  employee_name: string | null;
  employee_department: string | null;

  po_details: string | null;
  po_value: number;
  supplier_name: string | null;
  supplier_address: string | null;
  item_category: ItemCategory;
  item_description: string | null;
  qty: number | null;
  qty_issued: number | null;
  bill_details: string | null;
  indenter_name: string | null;
  source_of_fund: string | null;
  stock_entry: string | null;
  location: string | null;

  has_bank_guarantee: boolean | null;
  bank_guarantee_details: string | null;
  bank_guarantee_amount: number | null;
  date_of_installation: string | null;
  date_of_delivery: string | null;

  status: BillStatus;
  snp: DeskState | null;
  audit: DeskState | null;
  finance_admin: DeskState | null;
  noted: boolean;

  remarks: string | null;
  remarks1: string | null;
  remarks2: string | null;
  remarks3: string | null;
  remarks4: string | null;

  pda_committed: boolean;
  pda_settled: boolean;

  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One entry in the workflow event log. Append-only. */
export interface BillApprovalRow {
  id: string;
  bill_id: string;
  seq: number;
  stage: string;
  action:
    | "Submitted"
    | "Approved"
    | "Rejected"
    | "Hold"
    | "Forwarded"
    | "Registered"
    | "Notified";
  actor_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
  remark: string | null;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
  created_at: string;
}

/** One line in the departmental purchase register. Append-only. */
export interface PurchaseRegisterRow {
  id: string;
  serial_no: string;
  financial_year: string;
  bill_id: string;
  bill_number: string | null;
  entry_date: string;

  department: string;
  employee_code: string;
  employee_name: string | null;
  indenter_name: string | null;

  item_description: string | null;
  item_category: string | null;
  qty: number | null;
  supplier_name: string | null;
  supplier_address: string | null;
  amount: number;
  source_of_fund: string | null;
  stock_entry: string | null;
  location: string | null;

  recorded_by: string | null;
  recorded_at: string;
}

export interface DepartmentRow {
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number;
}

type Insert<T, Optional extends keyof T> = Omit<T, Optional> &
  Partial<Pick<T, Optional>>;

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: EmployeeRow;
        Insert: Insert<EmployeeRow, "id" | "created_at" | "updated_at" | "is_active" | "employee_type">;
        Update: Partial<EmployeeRow>;
        Relationships: [];
      };
      pda_balances: {
        Row: PdaBalanceRow;
        Insert: Insert<PdaBalanceRow, "id" | "updated_at" | "allocated" | "balance" | "committed" | "spent">;
        Update: Partial<PdaBalanceRow>;
        Relationships: [];
      };
      bills: {
        Row: BillRow;
        Insert: Insert<
          BillRow,
          | "id" | "bill_number" | "created_at" | "updated_at" | "decided_at"
          | "status" | "snp" | "audit" | "finance_admin" | "noted"
          | "pda_committed" | "pda_settled"
        >;
        Update: Partial<BillRow>;
        Relationships: [];
      };
      bill_approvals: {
        Row: BillApprovalRow;
        Insert: Insert<BillApprovalRow, "id" | "created_at">;
        Update: never;
        Relationships: [];
      };
      purchase_register: {
        Row: PurchaseRegisterRow;
        Insert: Insert<PurchaseRegisterRow, "id" | "recorded_at" | "entry_date">;
        Update: never;
        Relationships: [];
      };
      departments: {
        Row: DepartmentRow;
        Insert: Insert<DepartmentRow, "is_active" | "sort_order">;
        Update: Partial<DepartmentRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      fn_submit_bill: { Args: { p_payload: Json; p_actor: Json }; Returns: BillRow };
      fn_bill_action: {
        Args: {
          p_bill_id: string;
          p_actor_code: string;
          p_actor_name: string | null;
          p_actor_role: string;
          p_action: "Approved" | "Rejected" | "Hold";
          p_remark?: string | null;
          p_extra?: Json;
        };
        Returns: BillRow;
      };
      fn_set_pda_allocation: {
        Args: { p_employee_code: string; p_allocated: number; p_actor_code?: string | null };
        Returns: PdaBalanceRow;
      };
      fn_register_totals: {
        Args: { p_department?: string | null; p_fy?: string | null };
        Returns: Json;
      };
    };
    Enums: {
      department: string;
    };
    CompositeTypes: Record<string, never>;
  };
}

// ---------------------------------------------------------------------
// Aliases used across the pages. Kept so that the UI can talk about an
// "Employee" without every file importing "EmployeeRow".
// ---------------------------------------------------------------------
export type Employee = EmployeeRow;
export type PDABalance = PdaBalanceRow;
export type Bill = BillRow;
export type BillInsert = Database["public"]["Tables"]["bills"]["Insert"];
export type BillApproval = BillApprovalRow;
export type RegisterEntry = PurchaseRegisterRow;

/** A bill together with the person who filed it. */
export type BillWithEmployee = BillRow & {
  employees?: Pick<EmployeeRow, "employee_code" | "employee_name" | "email" | "department"> | null;
};
