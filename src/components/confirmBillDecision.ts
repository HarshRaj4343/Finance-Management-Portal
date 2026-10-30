import { money } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import type { Bill } from "@/types/database";
import type { ConfirmOptions } from "./ConfirmProvider";

export type Decision = "Approved" | "Hold" | "Rejected";

const VERB: Record<Decision, string> = { Approved: "Approve", Hold: "Hold", Rejected: "Reject" };

/** The confirmation every approval desk shows before a decision is sent. */
export function billDecisionPrompt(bill: Bill, action: Decision, remark: string, outcome: string, final = false): ConfirmOptions {
  // Finance Admin's approval is the last one: it releases the bill.
  const verb = final && action === "Approved" ? "Release" : VERB[action];
  return {
    title: `${verb} this bill?`,
    description: outcome,
    details: [
      ["Bill", bill.bill_number ?? bill.id],
      ["Applicant", `${bill.employee_name ?? ""} (${bill.employee_id})`],
      ["Supplier", bill.supplier_name ?? "—"],
      ["Amount", money(bill.po_value)],
      ["At desk", deskLabel(bill.status)],
      ["Remark", remark || "None"],
    ],
    confirmLabel: `Yes, ${verb.toLowerCase()}`,
    tone: action === "Approved" ? "default" : "danger",
  };
}
