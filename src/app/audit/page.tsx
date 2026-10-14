"use client";

import DeskQueue from "@/components/DeskQueue";

/** Audit: bills above ₹50,000, after Store and Purchase and before Finance Admin. */
export default function AuditDashboard() {
  return (
    <DeskQueue
      desk="Audit"
      title="Audit"
      description="Bills above ₹50,000 are checked here before Finance Admin."
      hints={{
        Pending: "Waiting for you",
        Approved: "Sent to Finance Admin",
        Hold: "Waiting for correction",
        Reject: "Funds released",
        All: "Every bill seen by Audit",
      }}
    />
  );
}
