"use client";

import DeskQueue from "@/components/DeskQueue";

/** Store and Purchase: the first desk for major and minor purchases. */
export default function SnpDashboard() {
  return (
    <DeskQueue
      desk="Student Purchase"
      title="Store and Purchase Department"
      description="Major and minor purchases are checked here first."
      hints={{
        Pending: "Waiting for you",
        Approved: "Sent on",
        Hold: "Waiting for correction",
        Reject: "Funds released",
        All: "Every bill at this desk",
      }}
    />
  );
}
