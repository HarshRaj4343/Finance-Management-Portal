"use client";

import DeskQueue from "@/components/DeskQueue";

/**
 * Finance Admin: the last desk. Releasing a bill here spends its money and
 * enters the purchase in the register. Managing employees is the Dean's job
 * (/admin), not this desk's.
 */
export default function FinanceAdminDashboard() {
  return (
    <DeskQueue
      desk="Finance Admin"
      title="Finance Admin"
      description="Release desk. Releasing a bill here debits its fund and enters the purchase in the register."
      hints={{
        Pending: "Waiting for you",
        Approved: "Ready for payment",
        Hold: "Waiting for correction",
        Reject: "Funds released",
        All: "Every bill seen by Finance Admin",
      }}
    />
  );
}
