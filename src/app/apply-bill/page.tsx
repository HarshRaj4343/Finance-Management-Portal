"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { billScopeQuery, normaliseRole } from "@/lib/roles";
import { useSession } from "next-auth/react";
import AppShell from "@/components/AppShell";
import { IconCheck, IconClock, IconFilePlus, IconX } from "@tabler/icons-react";
import UploadBill from "./UploadBill";
import BillsHistory from "./BillsHistory";
import ApprovedBills from "./ApprovedBills";
import PendingBills from "./PendingBills";
import { Bill } from "./types";

type PageView = "upload" | "pending" | "history" | "approved";

export default function EmployeeDashboard() {
  const { data: session, status } = useSession();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const canFile = normaliseRole(session?.user?.employee_type) === "Bill Employee";
  const [activePage, setActivePage] = useState<PageView>("upload");
  useEffect(() => {
    if (session && !canFile) setActivePage((p) => (p === "upload" ? "pending" : p));
  }, [session, canFile]);
  const [department, setDepartment] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);

  const [notice, setNotice] = useState<NoticeState>(null);

  // This desk is for the "Bill Employee" clerk role, which files bills and
  // corrects them. The retired "Bill Editor" role still lands here so that
  // existing accounts can correct bills, but cannot file new ones. The department
  // guard inside UploadBill assumes the filer belongs to a real,
  // multi-person department -- it was never meant to field people like the
  // Dean, whose "department" is a placeholder for a role of one.
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      if (typeof window !== "undefined") window.location.href = "/login";
      return;
    }

    if (session && !["Bill Employee", "Bill Editor"].includes(normaliseRole(session.user?.employee_type))) {
      window.location.href = "/";
    }
  }, [status, session]);

  /**
   * This desk files bills on behalf of a school. It shows the ones that
   * came back rejected and have not been acknowledged yet, so somebody can
   * see what needs re-filing.
   *
   * The department comes from /api/me rather than from a lookup with four
   * `like` patterns: employee codes are trimmed by a CHECK constraint now,
   * so there is nothing left to guess at.
   */
  const loadBills = async (dept: string) => {
    const { data, error } = await api.bills<{ bills: Bill[] }>(
      `/api/bills?${billScopeQuery(dept)}`
    );
    if (error) {
      setNotice({ kind: "bad", text: error });
      setBills([]);
      return;
    }
    setBills(
      data!.bills.filter(
        (b) =>
          (b.status === "Rejected" ||
            b.snp === "Reject" ||
            b.audit === "Reject" ||
            b.finance_admin === "Reject") &&
          !b.noted
      )
    );
  };

  useEffect(() => {
    if (!session?.user?.id) return;

    const run = async () => {
      setLoading(true);
      const me = await api.get<{ department: string | null }>("/api/me");
      if (me.error) {
        setNotice({ kind: "bad", text: me.error });
        setLoading(false);
        return;
      }

      const dept = me.data!.department;
      setDepartment(dept);

      if (!dept) {
        setBills([]);
        setNotice({
          kind: "info",
          text: "Your account has no department set. Ask the Dean of Finance's office to assign one.",
        });
        setLoading(false);
        return;
      }

      await loadBills(dept);
      setLoading(false);
    };

    run();
  }, [session, activePage]);

  const refreshBills = async () => {
    if (department) await loadBills(department);
  };

  // The form shows its own confirmation screen, so stay on it.
  const handleBillSubmitted = () => {
    setSubmittedCount((n) => n + 1);
    refreshBills();
  };

  const handleBillUpdated = () => refreshBills();

  const handleBillNoted = (billId: string) => {
    setBills((prev) => prev.filter((bill) => bill.id !== billId));
  };

  return (
    <AppShell
      desk={canFile ? "Bill Employee" : "Bill corrections"}
      fill={activePage === "upload"}
      nav={[
        ...(canFile ? [{ label: "Apply Bill", icon: <IconFilePlus />, onClick: () => setActivePage("upload"), active: activePage === "upload" }] : []),
        { label: "Pending Bills", icon: <IconClock />, onClick: () => setActivePage("pending"), active: activePage === "pending" },
        { label: "Rejected Bills", icon: <IconX />, onClick: () => setActivePage("history"), active: activePage === "history", badge: bills.length || null },
        { label: "Approved Bills", icon: <IconCheck />, onClick: () => setActivePage("approved"), active: activePage === "approved" },
      ]}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
        {activePage === "upload" && canFile && (
          <UploadBill onBillSubmitted={handleBillSubmitted} department={department} />
        )}

        {activePage === "pending" && (
          <PendingBills department={department} refreshKey={submittedCount} />
        )}

        {activePage === "history" && (
          <BillsHistory
            bills={bills}
            loading={loading}
            onBillUpdated={handleBillUpdated}
            allowNote
            onBillNoted={handleBillNoted}
          />
        )}

        {activePage === "approved" && <ApprovedBills department={department} />}
    </AppShell>
  );
}
