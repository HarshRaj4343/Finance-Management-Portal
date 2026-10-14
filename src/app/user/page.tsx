"use client";

import { deskLabel } from "@/lib/roles";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api, money } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import AppShell from "@/components/AppShell";
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
  Skipped: { icon: IconArrowRight, className: "bg-gray-100 text-gray-800" },
  Pending: { icon: IconClock, className: "bg-gray-100 text-gray-800" },
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
        submittedAt: bill.created_at ? new Date(bill.created_at).toLocaleString() : "N/A",
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

  const toneFor: Record<string, string> = {
    approved: "border-l-green-500", rejected: "border-l-red-500", hold: "border-l-amber-500", pending: "border-l-blue-500", unknown: "border-l-slate-400",
  };
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
                    <article key={bill.id} className={`flex flex-col rounded-xl border border-l-4 border-slate-200 bg-white p-5 shadow-sm ${toneFor[statusType] ?? toneFor.unknown}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-slate-500">{bill.bill_number ?? "—"}</p>
                          <h3 className="mt-0.5 line-clamp-2 font-semibold text-slate-900">{bill.item_description || "No description available"}</h3>
                          <p className="mt-0.5 truncate text-sm text-slate-600">{bill.supplier_name || "Supplier not recorded"}</p>
                        </div>
                        <p className="shrink-0 text-lg font-semibold tabular-nums">{money(bill.po_value)}</p>
                      </div>

                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div><dt className="text-xs text-slate-500">Category</dt><dd>{bill.item_category || "—"}</dd></div>
                        <div><dt className="text-xs text-slate-500">Quantity</dt><dd>{bill.qty || 0}</dd></div>
                        <div><dt className="text-xs text-slate-500">Filed</dt><dd>{bill.created_at ? new Date(bill.created_at).toLocaleDateString("en-IN") : "—"}</dd></div>
                      </dl>

                      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                        {badgeFor[statusType] && <StatusBadge value={badgeFor[statusType]} />}
                        <span className="text-slate-700">{statusLabel}</span>
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

      {/* Detailed Bill Modal */}
      <AnimatePresence>
        {selectedBill && (
          <motion.div
            className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-gray-50">
                <h2 className="text-xl font-bold text-gray-900">Bill Details</h2>
                <button
                  onClick={() => setSelectedBill(null)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                  aria-label="Close"
                >
                  <IconX size={20} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
                <div className="space-y-6">
                  {(() => {
                    const details = formatBillDetails(selectedBill);
                    return (
                      <>
                        {/* Basic Information */}
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h3 className="text-lg font-semibold mb-3 text-gray-800">Basic Information</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div><span className="font-medium">Bill ID:</span> {details.basicInfo.id}</div>
                            <div><span className="font-medium">Employee:</span> {details.basicInfo.employeeName}</div>
                            <div><span className="font-medium">Employee ID:</span> {details.basicInfo.employeeId}</div>
                            <div><span className="font-medium">Submitted:</span> {details.basicInfo.submittedAt}</div>
                          </div>
                        </div>

                        {/* Purchase Details */}
                        <div className="bg-blue-50 rounded-lg p-4">
                          <h3 className="text-lg font-semibold mb-3 text-gray-800">Purchase Details</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div><span className="font-medium">PO Details:</span> {details.purchaseDetails.poDetails || "N/A"}</div>
                            <div><span className="font-medium">Supplier:</span> {details.purchaseDetails.supplierName || "N/A"}</div>
                            <div><span className="font-medium">Category:</span> {details.purchaseDetails.itemCategory || "N/A"}</div>
                            <div><span className="font-medium">Quantity:</span> {details.purchaseDetails.quantity || 0}</div>
                            <div><span className="font-medium">Total Value:</span> ₹{details.purchaseDetails.totalValue?.toLocaleString() || "0"}</div>
                            <div className="md:col-span-2">
                              <span className="font-medium">Description:</span> {details.purchaseDetails.itemDescription || "N/A"}
                            </div>
                          </div>
                        </div>

                        {/* Workflow Progress */}
                        <div className="bg-green-50 rounded-lg p-4">
                          <h3 className="text-lg font-semibold mb-3 text-gray-800">Workflow Progress</h3>
                          <div className="space-y-2 text-sm">
                            {Object.entries(details.workflowProgress).map(([step, status]) => {
                              const tone = STEP_TONE[status] ?? STEP_TONE.Pending;
                              const StepIcon = tone.icon;
                              return (
                                <div key={step} className="flex justify-between items-center py-1">
                                  <span className="font-medium">{step.replace(/_/g, ' ').replace(/step\d+/i, '').replace('StoreAndPurchase', 'Store and Purchase Department').trim()}:</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${tone.className}`}>
                                    <StepIcon className="h-3.5 w-3.5 shrink-0" />
                                    {status}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Department Remarks */}
                        {details.departmentRemarks.length > 0 && (
                          <div className="bg-yellow-50 rounded-lg p-4">
                            <h3 className="text-lg font-semibold mb-3 text-gray-800">Department Remarks</h3>
                            <div className="space-y-3">
                              {details.departmentRemarks.map((remark, idx) => (
                                <div key={idx} className="bg-white rounded-lg p-3 border-l-4 border-yellow-400">
                                  <div className="font-semibold text-gray-800 mb-1">
                                    Remark by {remark.department}:
                                  </div>
                                  <div className="text-gray-700 text-sm">
                                    {remark.remark}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Current Status */}
                        <div className={`rounded-lg p-4 ${
                          details.currentStatus.statusType === "approved" ? "bg-green-50" :
                          details.currentStatus.statusType === "rejected" ? "bg-red-50" :
                          details.currentStatus.statusType === "hold" ? "bg-orange-50" :
                          "bg-blue-50"
                        }`}>
                          <h3 className="text-lg font-semibold mb-3 text-gray-800">Current Status</h3>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Overall Status:</span> {details.currentStatus.overall}</div>
                            <div><span className="font-medium">Store and Purchase Department Status:</span> {details.currentStatus.snpStatus}</div>
                            <div><span className="font-medium">Audit Status:</span> {details.currentStatus.auditStatus}</div>
                            <div><span className="font-medium">Finance Admin Status:</span> {details.currentStatus.financeAdminStatus}</div>
                            <div className="pt-2">
                              <span className={`inline-block px-3 py-2 rounded-lg font-bold text-sm ${
                                details.currentStatus.statusType === "approved" ? "bg-green-200 text-green-800" :
                                details.currentStatus.statusType === "rejected" ? "bg-red-200 text-red-800" :
                                details.currentStatus.statusType === "hold" ? "bg-orange-200 text-orange-800" :
                                "bg-blue-200 text-blue-800"
                              }`}>
                                {details.currentStatus.displayStatus}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

/* Sidebar Logos */

