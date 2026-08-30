"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { signOut, useSession } from "next-auth/react";
import {
  IconReceipt2,
  IconWallet,
  IconEye,
  IconX,
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconClock,
  IconExclamationMark,
  IconBan,
  IconFileText,
  IconAlertCircle,
  IconPlayerPause,
  IconRefresh,
  IconArrowRight,
} from "@tabler/icons-react";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import type { Bill } from "@/types/database";

import type { Employee } from "@/types/database";

type PdaBalanceRow = { balance: number };

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
  const router = useRouter();

  const [open, setOpen] = useState(false);
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
        api.get<{ bills: Bill[] }>("/api/bills?limit=500"),
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
      if (bill.snp === "Reject") statusLabel += " by SNP";
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
      if (bill.snp === "Hold") statusLabel += " by SNP";
      else if (bill.audit === "Hold") statusLabel += " by Audit";
      else if (bill.finance_admin === "Hold") statusLabel += " by Finance Admin";
      
    } else {
      statusType = "pending";
      // New workflow mapping: SNP only for Major/Minor; Consumables skip SNP
      if (bill.status === "Student Purchase" && bill.snp === "Pending") {
        statusLabel = "Pending at SNP";
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
    
    if (bill.remarks1) remarks.push({ department: "SNP", remark: bill.remarks1 });
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
        overall: bill.status,
        snpStatus: bill.snp || "NULL",
        auditStatus: bill.audit || "NULL",
        financeAdminStatus: bill.finance_admin || "NULL",
        displayStatus: statusLabel,
        statusType: statusType,
      },
      departmentRemarks: remarks,
      workflowProgress: {
        step1_Submission: "Completed",
        step2_SNP:
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

  const StatCard = ({ title, value, icon, color, description }: {
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    description: string;
  }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-4 shadow-lg border-2 ${color} bg-white`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        </div>
        <div className="text-3xl opacity-70">
          {icon}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {/* Sidebar */}
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-6 md:gap-10">
          <div className="flex flex-1 flex-col">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-4 md:mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <SidebarLink key={idx} link={link} />
              ))}
            </div>
          </div>

          {/* User info and logout (collapse behavior) */}
          <div className="flex flex-col gap-3 items-center">
            {open ? (
              <>
                <SidebarLink
                  link={{
                    label: employee?.employee_name || session?.user?.username || "User",
                    href: "#",
                    icon: (
                      <img
                        src="/iit.png"
                        className="h-7 w-7 shrink-0 rounded-full"
                        width={50}
                        height={50}
                        alt="IIT Mandi Logo"
                      />
                    ),
                  }}
                />
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
                >
                  <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <img
                  src="/iit.png"
                  className="h-7 w-7 rounded-full"
                  width={40}
                  height={40}
                  alt="IIT Mandi"
                />
                <button
                  onClick={() => setOpen(true)}
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                  className="p-1 rounded-full bg-white border shadow-sm hover:bg-gray-100"
                >
                  <IconChevronRight className="h-4 w-4 text-neutral-700" />
                </button>
              </div>
            )}
          </div>
        </SidebarBody>
      </Sidebar>

      {/* Main Dashboard */}
      <div className="flex-1 flex flex-col bg-gray-50 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Welcome Section */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                Welcome, {employee?.employee_name || session?.user?.username}
              </h1>
              <p className="text-gray-600 text-sm md:text-base">
                Integrated Finance Management Portal - IIT Mandi
              </p>
            </motion.div>

            {/* PDA Balance Section */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-md"
              >
                {showBalance ? "Hide PDA Balance" : "Show PDA Balance"}
              </button>
              <AnimatePresence>
                {showBalance && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg"
                  >
                    <p className="text-lg md:text-xl font-bold text-green-800">
                      Current PDA Balance: ₹{balance.toLocaleString()}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
              <StatCard
                title="Total Bills"
                value={billStats.total}
                icon={<IconFileText />}
                color="border-blue-200"
                description="All submitted bills"
              />
              <StatCard
                title="Pending"
                value={billStats.pending}
                icon={<IconClock />}
                color="border-yellow-200"
                description="Under review"
              />
              <StatCard
                title="Approved"
                value={billStats.approved}
                icon={<IconCheck />}
                color="border-green-200"
                description="Fully approved"
              />
              <StatCard
                title="Rejected"
                value={billStats.rejected}
                icon={<IconBan />}
                color="border-red-200"
                description="Rejected bills"
              />
              <StatCard
                title="On Hold"
                value={billStats.onHold}
                icon={<IconAlertCircle />}
                color="border-orange-200"
                description="Temporarily paused"
              />
            </div>

            {/* Bills Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-xl shadow-lg p-6"
            >
              <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                <IconReceipt2 className="text-blue-600" />
                Your Bill Applications
              </h2>
              
              {bills.length === 0 ? (
                <div className="text-center py-12">
                  <IconFileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">No bills submitted yet.</p>
                  <p className="text-gray-400 text-sm">Your submitted bills will appear here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {bills.map((bill, index) => {
                    const { statusLabel, statusType } = getBillStatus(bill);
                    const remarks = getBillRemarks(bill);

                    const cardColors = {
                      approved: "border-green-500 bg-green-50",
                      rejected: "border-red-500 bg-red-50",
                      hold: "border-orange-500 bg-orange-50",
                      pending: "border-blue-500 bg-blue-50",
                      unknown: "border-gray-500 bg-gray-50",
                    };

                    const statusIcons = {
                      approved: <IconCheck className="text-green-600" />,
                      rejected: <IconBan className="text-red-600" />,
                      hold: <IconAlertCircle className="text-orange-600" />,
                      pending: <IconClock className="text-blue-600" />,
                      unknown: <IconExclamationMark className="text-gray-600" />,
                    };

                    return (
                      <motion.div
                        key={bill.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className={`rounded-xl p-5 border-2 shadow-md hover:shadow-lg transition-all duration-300 ${
                          cardColors[statusType as keyof typeof cardColors]
                        }`}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-gray-800 line-clamp-2">
                              {bill.item_description || "No description available"}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              PO: {bill.po_details || "N/A"} | Supplier: {bill.supplier_name || "N/A"}
                            </p>
                          </div>
                          <div className="ml-3">
                            {statusIcons[statusType as keyof typeof statusIcons]}
                          </div>
                        </div>

                        {/* Details */}
                        <div className="space-y-2 mb-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Amount:</span>
                            <span className="font-semibold">₹{bill.po_value?.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Quantity:</span>
                            <span className="font-semibold">{bill.qty || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Category:</span>
                            <span className="font-semibold">{bill.item_category || "N/A"}</span>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="mb-4">
                          <p className="text-sm font-medium text-gray-700 mb-1">Current Status:</p>
                          <p className={`text-sm font-bold ${
                            statusType === "approved" ? "text-green-700" :
                            statusType === "rejected" ? "text-red-700" :
                            statusType === "hold" ? "text-orange-700" :
                            statusType === "pending" ? "text-blue-700" : "text-gray-700"
                          }`}>
                            {statusLabel}
                          </p>
                        </div>

                        {/* Remarks */}
                        {remarks.length > 0 && (
                          <div className="mb-4">
                            <p className="text-sm font-medium text-gray-700 mb-2">Department Remarks:</p>
                            <div className="space-y-1">
                              {remarks.map((remark, idx) => (
                                <div key={idx} className="text-xs bg-white bg-opacity-50 rounded p-2 border">
                                  <span className="font-semibold text-gray-800">{remark.department}:</span>
                                  <span className="text-gray-700 ml-2">{remark.remark}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Submission Date */}
                        <div className="mb-4">
                          <p className="text-xs text-gray-500">
                            Submitted: {bill.created_at ? new Date(bill.created_at).toLocaleDateString() : "N/A"}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end">
                          <button
                            onClick={() => setSelectedBill(bill)}
                            className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-80 hover:bg-opacity-100 text-gray-700 hover:text-gray-900 rounded-lg border border-gray-300 hover:border-gray-400 transition-all text-sm font-medium"
                          >
                            <IconEye size={16} />
                            View Details
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>

      {/* Detailed Bill Modal */}
      <AnimatePresence>
        {selectedBill && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4"
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
                                  <span className="font-medium">{step.replace(/_/g, ' ').replace(/step\d+/i, '').trim()}:</span>
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
                            <div><span className="font-medium">SNP Status:</span> {details.currentStatus.snpStatus}</div>
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
    </div>
  );
}

/* Sidebar Logos */
const Logo = () => (
  <a href="#" className="flex items-center space-x-2 py-1 text-sm font-semibold text-black">
    <img src="/iit.png" alt="IIT Mandi" className="h-7 w-7" />
    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-pre text-black">
      IIT Mandi Finance
    </motion.span>
  </a>
);

const LogoIcon = () => (
  <a href="#" className="flex items-center space-x-2 py-1 text-sm font-semibold text-black">
    <img src="/iit.png" alt="IIT Mandi" className="h-7 w-7" />
  </a>
);