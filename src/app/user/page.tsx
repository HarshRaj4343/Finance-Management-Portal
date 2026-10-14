"use client";

import { deskLabel } from "@/lib/roles";
import React, { useEffect, useState } from "react";
import { api, money, when, dateOnly } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import AppShell from "@/components/AppShell";
import RouteTracker from "@/components/RouteTracker";
import Modal, { btn } from "@/components/ui/modal";
import { EmptyState, LoadingState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui/page";
import { useSession } from "next-auth/react";
import {
  IconWallet,
  IconEye,
  IconX,
  IconCheck,
  IconClock,
  IconBan,
  IconFileText,
  IconAlertCircle,
  IconPlayerPause,
  IconRefresh,
  IconArrowRight,
} from "@tabler/icons-react";

import type { Bill } from "@/types/database";

import type { Employee } from "@/types/database";

interface BillStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  onHold: number;
}

// Each workflow step is shown with a Tabler SVG icon rather than an emoji, so the
// badges render identically on every platform and print cleanly.
const STEP_TONE: Record<string, { icon: typeof IconCheck; className: string }> = {
  Completed: { icon: IconCheck, className: "bg-green-100 text-green-800" },
  Complete: { icon: IconCheck, className: "bg-green-100 text-green-800" },
  Approved: { icon: IconCheck, className: "bg-green-100 text-green-800" },
  Rejected: { icon: IconX, className: "bg-red-100 text-red-800" },
  "On Hold": { icon: IconPlayerPause, className: "bg-orange-100 text-orange-800" },
  "In Progress": { icon: IconRefresh, className: "bg-blue-100 text-blue-800" },
  Skipped: { icon: IconArrowRight, className: "bg-slate-100 text-slate-800" },
  Pending: { icon: IconClock, className: "bg-slate-100 text-slate-800" },
};

export default function UserPage() {
  const { data: session } = useSession();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [billStats, setBillStats] = useState<BillStats>({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    onHold: 0,
  });

  const [notice, setNotice] = useState<NoticeState>(null);

  /**
   * Everything on this page comes from two endpoints. /api/me knows who is
   * asking and returns their PDA position; /api/bills returns only their
   * own bills, because the server scopes it by role rather than trusting
   * a filter sent up from the browser.
   */
  useEffect(() => {
    if (!session?.user?.username) return;

    const fetchData = async () => {
      setLoading(true);

      const [me, mine] = await Promise.all([
        api.get<{
          code: string;
          name: string;
          email: string | null;
          department: string | null;
          role: string;
          provisioned: boolean;
          pda: { allocated: number; balance: number; committed: number; spent: number } | null;
        }>("/api/me"),
        api.bills<{ bills: Bill[] }>(`/api/bills?employee=${encodeURIComponent(session.user.employee_code ?? session.user.username)}`),
      ]);

      setLoading(false);

      if (me.error || mine.error) {
        setNotice({ kind: "bad", text: me.error ?? mine.error! });
        return;
      }

      setEmployee({
        id: me.data!.code,
        employee_code: me.data!.code,
        employee_name: me.data!.name,
        email: me.data!.email ?? "",
        department: me.data!.department ?? "",
        employee_type: me.data!.role,
        is_active: true,
        created_at: "",
        updated_at: "",
      } as Employee);

      setBalance(me.data!.pda ? Number(me.data!.pda.balance) : 0);

      if (!me.data!.provisioned) {
        setNotice({
          kind: "info",
          text:
            "You are signed in, but nobody has been assigned to your account yet. " +
            "Contact the Dean of Finance's office to have your role set up.",
        });
      }

      const bills = mine.data!.bills;
      setBills(bills);

      // A bill is rejected the moment any desk rejects it -- rejection is
      // terminal, so it can never come back from that.
      const stats: BillStats = {
        total: bills.length,
        pending: 0,
        approved: 0,
        rejected: 0,
        onHold: 0,
      };
      for (const bill of bills) {
        if (bill.status === "Accepted") stats.approved++;
        else if (bill.status === "Rejected") stats.rejected++;
        else if (
          bill.snp === "Hold" ||
          bill.audit === "Hold" ||
          bill.finance_admin === "Hold"
        )
          stats.onHold++;
        else stats.pending++;
      }
      setBillStats(stats);
    };

    fetchData();
  }, [session]);

  const getBillStatus = (bill: Bill) => {
    let statusLabel = "Unknown";
    let statusType = "unknown";

    if (bill.status === "Accepted") {
      statusLabel = "Approved (All Stages)";
      statusType = "approved";
    } else if (
      bill.audit === "Reject" ||
      bill.finance_admin === "Reject" ||
      bill.snp === "Reject"
    ) {
      statusLabel = "Rejected";
      statusType = "rejected";
      
      // Find which department rejected
      if (bill.snp === "Reject") statusLabel += " by Store and Purchase Department";
      else if (bill.audit === "Reject") statusLabel += " by Audit";
      else if (bill.finance_admin === "Reject") statusLabel += " by Finance Admin";
      
    } else if (
      bill.audit === "Hold" ||
      bill.finance_admin === "Hold" ||
      bill.snp === "Hold"
    ) {
      statusLabel = "On Hold";
      statusType = "hold";
      
      // Find which department put on hold
      if (bill.snp === "Hold") statusLabel += " by Store and Purchase Department";
      else if (bill.audit === "Hold") statusLabel += " by Audit";
      else if (bill.finance_admin === "Hold") statusLabel += " by Finance Admin";
      
    } else {
      statusType = "pending";
      // New workflow mapping: SNP only for Major/Minor; Consumables skip SNP
      if (bill.status === "Student Purchase" && bill.snp === "Pending") {
        statusLabel = "Pending at Store and Purchase Department";
      } else if (bill.status === "Audit" && bill.audit === "Pending") {
        statusLabel = "Pending at Audit";
      } else if (bill.status === "Finance Admin" && bill.finance_admin === "Pending") {
        statusLabel = "Pending at Finance Admin";
      } else if (bill.status === "User") {
        statusLabel = "Submitted - Processing Started";
      }
    }

    return { statusLabel, statusType };
  };

  const getBillRemarks = (bill: Bill) => {
    const remarks: { department: string; remark: string }[] = [];
    
    if (bill.remarks1) remarks.push({ department: "Store and Purchase Department", remark: bill.remarks1 });
    if (bill.remarks2) remarks.push({ department: "Audit", remark: bill.remarks2 });
    if (bill.remarks) remarks.push({ department: "Finance Admin", remark: bill.remarks });
    if (bill.remarks3) remarks.push({ department: "Other", remark: bill.remarks3 });
    if (bill.remarks4) remarks.push({ department: "Additional", remark: bill.remarks4 });
    
    return remarks;
  };

  const formatBillDetails = (bill: Bill) => {
    const { statusLabel, statusType } = getBillStatus(bill);
    const remarks = getBillRemarks(bill);
    
    return {
      basicInfo: {
        id: bill.id,
        employeeId: bill.employee_id,
        employeeName: bill.employee_name,
        submittedAt: when(bill.created_at),
      },
      purchaseDetails: {
        poDetails: bill.po_details,
        supplierName: bill.supplier_name,
        itemDescription: bill.item_description,
        itemCategory: bill.item_category,
        quantity: bill.qty,
        totalValue: bill.po_value,
      },
      currentStatus: {
        overall: deskLabel(bill.status),
        snpStatus: bill.snp || "NULL",
        auditStatus: bill.audit || "NULL",
        financeAdminStatus: bill.finance_admin || "NULL",
        displayStatus: statusLabel,
        statusType: statusType,
      },
      departmentRemarks: remarks,
      workflowProgress: {
        step1_Submission: "Completed",
        step2_StoreAndPurchase:
          bill.snp == null && (bill.status === "Audit" || bill.status === "Finance Admin")
            ? "Skipped"
            : bill.snp === "Approved"
            ? "Approved"
            : bill.snp === "Reject"
            ? "Rejected"
            : bill.snp === "Hold"
            ? "On Hold"
            : bill.snp === "Pending"
            ? "In Progress"
            : "Pending",
        step3_Audit:
          bill.audit == null && bill.status === "Finance Admin"
            ? "Skipped"
            : bill.audit === "Approved"
            ? "Approved"
            : bill.audit === "Reject"
            ? "Rejected"
            : bill.audit === "Hold"
            ? "On Hold"
            : bill.audit === "Pending"
            ? "In Progress"
            : "Pending",
        step4_FinanceAdmin:
          bill.finance_admin === "Approved"
            ? "Approved"
            : bill.finance_admin === "Reject"
            ? "Rejected"
            : bill.finance_admin === "Hold"
            ? "On Hold"
            : bill.finance_admin === "Pending"
            ? "In Progress"
            : "Pending",
        step5_FinalApproval: bill.status === "Accepted" ? "Complete" : "Pending",
      }
    };
  };

  const links = [
    { 
      label: "Dashboard", 
      href: "/user", 
      icon: <IconWallet className="h-5 w-5 shrink-0 text-neutral-700" /> 
    },
  ];

  const badgeFor: Record<string, string> = {
    approved: "Accepted", rejected: "Rejected", hold: "Hold", pending: "Pending", unknown: "",
  };

  return (
    <AppShell desk="My bills" nav={links.map((l) => ({ label: l.label, icon: l.icon, href: l.href, active: true }))}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {loading ? <LoadingState label="Loading dashboard…" /> : (
        <>
          <PageHeader
            title={`Welcome, ${employee?.employee_name || session?.user?.username || ""}`}
            description="Track the bills filed for you and your PDA balance."
            actions={
              <button
                onClick={() => setShowBalance(!showBalance)}
                aria-expanded={showBalance}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <IconWallet className="size-4" />
                {showBalance ? `PDA balance: ${money(balance)}` : "Show PDA balance"}
              </button>
            }
          />

          <StatGrid>
            <StatCard label="Total Bills" value={billStats.total} hint="All submitted bills" icon={<IconFileText />} />
            <StatCard label="Pending" value={billStats.pending} hint="Under review" tone="blue" icon={<IconClock />} />
            <StatCard label="Approved" value={billStats.approved} hint="Fully approved" tone="green" icon={<IconCheck />} />
            <StatCard label="Rejected" value={billStats.rejected} hint="Not approved" tone="red" icon={<IconBan />} />
            <StatCard label="On Hold" value={billStats.onHold} hint="Waiting for correction" tone="amber" icon={<IconAlertCircle />} />
          </StatGrid>

          <section className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Your bills</h2>
            {bills.length === 0 ? (
              <EmptyState icon={<IconFileText />} title="No bills submitted yet" description="Bills filed for you will appear here." />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {bills.map((bill) => {
                  const { statusLabel, statusType } = getBillStatus(bill);
                  const remarks = getBillRemarks(bill);
                  return (
                    <article key={bill.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-mono text-xs text-slate-500">{bill.bill_number ?? "—"}</p>
                            {badgeFor[statusType] && <StatusBadge value={badgeFor[statusType]} />}
                          </div>
                          <h3 className="mt-0.5 line-clamp-2 font-semibold text-slate-900">{bill.item_description || "No description available"}</h3>
                          <p className="mt-0.5 truncate text-sm text-slate-600">{bill.supplier_name || "Supplier not recorded"}</p>
                        </div>
                        <p className="shrink-0 text-lg font-semibold tabular-nums">{money(bill.po_value)}</p>
                      </div>

                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div><dt className="text-xs text-slate-500">Category</dt><dd>{bill.item_category || "—"}</dd></div>
                        <div><dt className="text-xs text-slate-500">Quantity</dt><dd>{bill.qty || 0}</dd></div>
                        <div><dt className="text-xs text-slate-500">Filed</dt><dd>{dateOnly(bill.created_at)}</dd></div>
                      </dl>

                      <div className="mt-4 rounded-lg bg-slate-50 px-3 pb-2 pt-3">
                        <RouteTracker bill={bill} />
                        <p className="mt-2 text-center text-xs text-slate-600">{statusLabel}</p>
                      </div>

                      {remarks.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {remarks.map((remark, idx) => (
                            <p key={idx} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                              <span className="font-medium text-slate-900">{remark.department}:</span> {remark.remark}
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="mt-auto flex justify-end pt-4">
                        <button
                          onClick={() => setSelectedBill(bill)}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <IconEye size={16} /> View details
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {selectedBill && (() => {
        const details = formatBillDetails(selectedBill);
        return (
          <Modal
            title={`Bill ${selectedBill.bill_number ?? ""}`.trim()}
            description={selectedBill.item_description || undefined}
            onClose={() => setSelectedBill(null)}
            size="lg"
            footer={<>
              <button onClick={() => setSelectedBill(null)} className={btn.secondary}>Close</button>
              <a href={`/bill/${selectedBill.id}`} className={btn.primary}>Open full bill page</a>
            </>}
          >
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {([
                ["Applicant", `${details.basicInfo.employeeName ?? ""} (${details.basicInfo.employeeId})`],
                ["Filed", details.basicInfo.submittedAt],
                ["Supplier", details.purchaseDetails.supplierName || "—"],
                ["PO", details.purchaseDetails.poDetails || "—"],
                ["Category", details.purchaseDetails.itemCategory || "—"],
                ["Quantity", String(details.purchaseDetails.quantity ?? 0)],
                ["Amount", money(details.purchaseDetails.totalValue)],
                ["Status", details.currentStatus.displayStatus],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>

            <section aria-label="Approval progress">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Approval progress</h3>
              <ol className="space-y-1.5 text-sm">
                {Object.entries(details.workflowProgress).map(([step, status]) => {
                  const tone = STEP_TONE[status] ?? STEP_TONE.Pending;
                  const StepIcon = tone.icon;
                  return (
                    <li key={step} className="flex items-center justify-between gap-3">
                      <span className="text-slate-700">{step.replace(/_/g, " ").replace(/step\d+/i, "").replace("StoreAndPurchase", "Store and Purchase Department").replace("FinalApproval", "Final approval").replace("FinanceAdmin", "Finance Admin").trim()}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone.className}`}>
                        <StepIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        {status}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            {details.departmentRemarks.length > 0 && (
              <section aria-label="Remarks">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Remarks</h3>
                <div className="space-y-2">
                  {details.departmentRemarks.map((remark, idx) => (
                    <p key={idx} className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{remark.department}:</span> {remark.remark}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </Modal>
        );
      })()}
    </AppShell>
  );
}

/* Sidebar Logos */

