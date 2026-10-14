"use client";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole, deskLabel } from "@/lib/roles";
import { useSession } from "next-auth/react";
import {
  IconCheck,
  IconX,
  IconClockPause,
  IconListDetails,
  IconClock,
  IconAlertCircle,
} from "@tabler/icons-react";
import BillCard from "@/components/BillCard";
import AppShell from "@/components/AppShell";
import DeskReviewPanel from "@/components/DeskReviewPanel";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { EmptyState, LoadingState, PageHeader, StatCard, StatGrid } from "@/components/ui/page";
import { canReviewDesk, latestArrivalFirst } from "@/lib/bill-review";

/* ---------- Interfaces ---------- */
import type { Bill } from "@/types/database";

export default function AuditDashboard() {
  const { data: session, status } = useSession();
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<
    "All" | "Approved" | "Hold" | "Reject" | "Pending"
  >("Pending");
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBillDetails, setSelectedBillDetails] = useState<Bill | null>(null);
  
  const [notice, setNotice] = useState<NoticeState>(null);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [amountFilter, setAmountFilter] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const [dateFilter, setDateFilter] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [locationFilter, setLocationFilter] = useState("");

  // Access control: Only allow users with employee_type === "Audit"
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return;
    }

    if (session && normaliseRole(session.user?.employee_type) !== "Audit") {
      // Not this desk. Send them back to the portal rather than signing
      // them out, which used to lose their session for a mis-click.
      window.location.href = "/";
    }
  }, [status, session]);

  // Every bill that has ever reached the audit desk, whether it is still
  // here, has been sent on, or was rejected. The server decides what this
  // role may see; the browser no longer asks for the whole table.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (normaliseRole(session?.user?.employee_type) !== "Audit") return;

    const fetchBills = async () => {
      setLoading(true);
      const { data, error } = await api.bills<{ bills: Bill[] }>("/api/bills?limit=500");
      setLoading(false);
      if (error) {
        setNotice({ kind: "bad", text: error });
        return;
      }
      // Bills the audit desk has a stake in: sitting here now, or carrying
      // a recorded audit decision from earlier.
      const mine = data!.bills.filter((b) => b.status === "Audit" || b.audit !== null);
      setBills(mine);
      setFilteredBills(mine);
    };
    fetchBills();
  }, [status, session]);

  // Apply filters whenever search criteria change
  useEffect(() => {
    let filtered = bills;

    // Status filter
    if (activeFilter !== "All") {
      filtered = filtered.filter((b) => b.audit === activeFilter);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((b) => 
        b.po_details?.toLowerCase().includes(query) ||
        b.supplier_name?.toLowerCase().includes(query) ||
        b.employee_name?.toLowerCase().includes(query) ||
        b.employee_id?.toLowerCase().includes(query) ||
        b.item_description?.toLowerCase().includes(query) ||
        b.bill_details?.toLowerCase().includes(query) ||
        b.indenter_name?.toLowerCase().includes(query)
      );
    }

    // Category filter
    if (categoryFilter !== "All") {
      filtered = filtered.filter((b) => b.item_category === categoryFilter);
    }

    // Amount filter
    if (amountFilter.min || amountFilter.max) {
      const min = amountFilter.min ? parseFloat(amountFilter.min) : 0;
      const max = amountFilter.max ? parseFloat(amountFilter.max) : Infinity;
      filtered = filtered.filter((b) => b.po_value >= min && b.po_value <= max);
    }

    // Date filter
    if (dateFilter.start || dateFilter.end) {
      filtered = filtered.filter((b) => {
        if (!b.created_at) return false;
        const billDate = new Date(b.created_at);
        const start = dateFilter.start ? new Date(dateFilter.start) : new Date("1900-01-01");
        const end = dateFilter.end ? new Date(dateFilter.end) : new Date("2100-12-31");
        return billDate >= start && billDate <= end;
      });
    }

    // Location filter
    if (locationFilter.trim()) {
      const location = locationFilter.toLowerCase();
      filtered = filtered.filter((b) => 
        b.location?.toLowerCase().includes(location) ||
        b.supplier_address?.toLowerCase().includes(location)
      );
    }

    // Newest arrival at this desk first.
    setFilteredBills([...filtered].sort(latestArrivalFirst));
  }, [bills, activeFilter, searchQuery, categoryFilter, amountFilter, dateFilter, locationFilter]);

  /**
   * All three decisions take the same route: /api/bills/:id/action, which
   * calls fn_bill_action. The database checks that this bill is actually
   * at the audit desk, moves it, releases or holds the money, and writes
   * the event log -- as one transaction. The email goes from the server
   * afterwards, so a mail failure cannot undo a recorded decision.
   */



  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("All");
    setAmountFilter({ min: "", max: "" });
    setDateFilter({ start: "", end: "" });
    setLocationFilter("");
  };

  const formatBillDetails = (bill: Bill) => {
    return {
      basicInfo: {
        id: bill.id,
        employeeId: bill.employee_id,
        employeeName: bill.employee_name,
        submittedAt: bill.created_at ? new Date(bill.created_at).toLocaleString() : "N/A",
      },
      purchaseDetails: {
        poDetails: bill.po_details || "N/A",
        supplierName: bill.supplier_name || "N/A",
        supplierAddress: bill.supplier_address || "N/A",
        itemDescription: bill.item_description || "N/A",
        itemCategory: bill.item_category || "N/A",
        quantity: bill.qty || 0,
        totalValue: bill.po_value || 0,
        billDetails: bill.bill_details || "N/A",
        indenterName: bill.indenter_name || "N/A",
        qtyIssued: bill.qty_issued || 0,
        sourceOfFund: bill.source_of_fund || "N/A",
        stockEntry: bill.stock_entry || "N/A",
        location: bill.location || "N/A",
      },
      workflowStatus: {
        overall: deskLabel(bill.status),
        snpStatus: bill.snp || "NULL",
        auditStatus: bill.audit || "Pending",
        financeAdminStatus: bill.finance_admin || "NULL",
      },
      departmentRemarks: {
        snp: bill.remarks1 || "No remark from Store and Purchase Department",
        audit: bill.remarks2 || "No remark yet",
        financeAdmin: bill.remarks3 || "Not reached Finance Admin yet",
        other: bill.remarks4 || "No additional remark",
      }
    };
  };

  const pendingCount = bills.filter((b) => b.audit === "Pending").length;
  const approvedCount = bills.filter((b) => b.audit === "Approved").length;
  const holdCount = bills.filter((b) => b.audit === "Hold").length;
  const rejectCount = bills.filter((b) => b.audit === "Reject").length;

  const links = [
    {
      label: "All Bills",
      icon: <IconListDetails className="h-5 w-5 shrink-0 text-blue-600" />,
      onClick: () => setActiveFilter("All"),
    },
    {
      label: "Pending Bills",
      icon: <IconClock className="h-5 w-5 shrink-0 text-orange-600" />,
      onClick: () => setActiveFilter("Pending"),
    },
    {
      label: "Approved Bills",
      icon: <IconCheck className="h-5 w-5 shrink-0 text-green-600" />,
      onClick: () => setActiveFilter("Approved"),
    },
    {
      label: "Hold Bills",
      icon: <IconClockPause className="h-5 w-5 shrink-0 text-yellow-600" />,
      onClick: () => setActiveFilter("Hold"),
    },
    {
      label: "Rejected Bills",
      icon: <IconX className="h-5 w-5 shrink-0 text-red-600" />,
      onClick: () => setActiveFilter("Reject"),
    },
  ];

  // Block render for non-authorized users after hooks have initialized
  if (status !== "authenticated" || session?.user?.employee_type !== "Audit") {
    return null;
  }

  const filtersActive = Boolean(searchQuery || categoryFilter !== "All" || amountFilter.min || amountFilter.max || dateFilter.start || dateFilter.end || locationFilter);
  const counts: Record<string, number> = { All: bills.length, Pending: pendingCount, Approved: approvedCount, Hold: holdCount, Reject: rejectCount };

  return (
    <AppShell
      desk="Audit"
      nav={links.map((link) => {
        const key = link.label.replace(" Bills", "");
        const filter = key === "Rejected" ? "Reject" : key;
        return { label: link.label === "All Bills" ? "All" : link.label, icon: link.icon, onClick: link.onClick, active: activeFilter === filter, badge: counts[filter] ?? null };
      })}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader title="Audit" description={`Bills above ₹50,000 are checked here before Finance Admin. ${pendingCount} waiting.`} />

      {loading ? <LoadingState label="Loading Audit bills…" /> : (
        <>
          <StatGrid>
            <StatCard label="Pending" value={pendingCount} hint="Waiting for you" tone="blue" icon={<IconClock />} onClick={() => setActiveFilter("Pending")} active={activeFilter === "Pending"} />
            <StatCard label="Approved" value={approvedCount} hint="Sent to Finance Admin" tone="green" icon={<IconCheck />} onClick={() => setActiveFilter("Approved")} active={activeFilter === "Approved"} />
            <StatCard label="Hold" value={holdCount} hint="Waiting for correction" tone="amber" icon={<IconClockPause />} onClick={() => setActiveFilter("Hold")} active={activeFilter === "Hold"} />
            <StatCard label="Rejected" value={rejectCount} hint="Funds released" tone="red" icon={<IconX />} onClick={() => setActiveFilter("Reject")} active={activeFilter === "Reject"} />
            <StatCard label="All" value={bills.length} hint="Every bill seen by Audit" icon={<IconListDetails />} onClick={() => setActiveFilter("All")} active={activeFilter === "All"} />
          </StatGrid>

          <FilterBar
            search={searchQuery}
            onSearch={setSearchQuery}
            placeholder="Search by PO, supplier, employee or item"
            onClear={clearFilters}
            active={filtersActive}
            summary={`Showing ${filteredBills.length} of ${bills.length} bills`}
          >
            <FilterField label="Category">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={filterInput}>
                <option value="All">All categories</option>
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
                <option value="Consumables">Consumables</option>
              </select>
            </FilterField>
            <FilterField label="Amount (₹)">
              <div className="flex gap-2">
                <input type="number" placeholder="Min" value={amountFilter.min} onChange={(e) => setAmountFilter((prev) => ({ ...prev, min: e.target.value }))} className={filterInput} />
                <input type="number" placeholder="Max" value={amountFilter.max} onChange={(e) => setAmountFilter((prev) => ({ ...prev, max: e.target.value }))} className={filterInput} />
              </div>
            </FilterField>
            <FilterField label="Filed between">
              <div className="flex gap-2">
                <input type="date" aria-label="From" value={dateFilter.start} onChange={(e) => setDateFilter((prev) => ({ ...prev, start: e.target.value }))} className={filterInput} />
                <input type="date" aria-label="To" value={dateFilter.end} onChange={(e) => setDateFilter((prev) => ({ ...prev, end: e.target.value }))} className={filterInput} />
              </div>
            </FilterField>
            <FilterField label="Location">
              <input type="text" placeholder="Building, room or address" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className={filterInput} />
            </FilterField>
          </FilterBar>

          {filteredBills.length === 0 ? (
            <EmptyState
              icon={<IconAlertCircle />}
              title={`No ${activeFilter === "All" ? "" : activeFilter === "Reject" ? "rejected " : `${activeFilter.toLowerCase()} `}bills found`}
              description={filtersActive ? "Try adjusting your search or filters." : undefined}
            />
          ) : (
            <div className="space-y-4">
              {filteredBills.map((bill) => {
                const canTakeAction = canReviewDesk(bill, "Audit", session?.user?.employee_code, session?.user?.employee_type);
                return (
                  <BillCard key={bill.id} bill={bill} showBankGuarantee>
                    {canTakeAction ? (
                      <DeskReviewPanel
                        bill={bill}
                        desk="Audit"
                        actorCode={session?.user?.employee_code}
                        actorRole={session?.user?.employee_type}
                        onDecided={(updated, text) => {
                          setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
                          setNotice({ kind: "ok", text });
                        }}
                      />
                    ) : (
                      <p className={`flex items-center gap-2 text-sm font-medium ${bill.audit === "Approved" ? "text-green-800" : bill.audit === "Reject" ? "text-red-800" : "text-slate-600"}`}>
                        {bill.audit === "Approved" ? <IconCheck className="size-4" /> : bill.audit === "Reject" ? <IconX className="size-4" /> : null}
                        {bill.audit === "Approved" ? "Approved by Audit and sent on to Finance Admin."
                          : bill.audit === "Reject" ? "Rejected by Audit."
                          : `With ${deskLabel(bill.status)}.`}
                      </p>
                    )}
                  </BillCard>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Bill Detail Modal */}
      <AnimatePresence>
        {showDetailModal && selectedBillDetails && (
          <motion.div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
            >
              <div className="flex justify-between items-center p-6 border-b">
                <h3 className="text-xl font-semibold">Bill Details - Audit Review</h3>
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedBillDetails(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <IconX size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {(() => {
                  const details = formatBillDetails(selectedBillDetails);
                  return (
                    <>
                      {/* Basic Info */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3 text-gray-800">Basic Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">Bill ID:</span> {details.basicInfo.id}</div>
                          <div><span className="font-medium">Employee ID:</span> {details.basicInfo.employeeId}</div>
                          <div><span className="font-medium">Employee Name:</span> {details.basicInfo.employeeName}</div>
                          <div><span className="font-medium">Submitted:</span> {details.basicInfo.submittedAt}</div>
                        </div>
                      </div>

                      {/* Purchase Details */}
                      <div className="bg-blue-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3 text-gray-800">Purchase Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">PO Details:</span> {details.purchaseDetails.poDetails}</div>
                          <div><span className="font-medium">Supplier:</span> {details.purchaseDetails.supplierName}</div>
                          <div><span className="font-medium">Supplier Address:</span> {details.purchaseDetails.supplierAddress}</div>
                          <div><span className="font-medium">Category:</span> {details.purchaseDetails.itemCategory}</div>
                          <div><span className="font-medium">Quantity:</span> {details.purchaseDetails.quantity}</div>
                          <div><span className="font-medium">Qty Issued:</span> {details.purchaseDetails.qtyIssued}</div>
                          <div><span className="font-medium">Source of Fund:</span> {details.purchaseDetails.sourceOfFund}</div>
                          <div><span className="font-medium">Stock Entry:</span> {details.purchaseDetails.stockEntry}</div>
                          <div><span className="font-medium">Location:</span> {details.purchaseDetails.location}</div>
                          <div><span className="font-medium">Indenter:</span> {details.purchaseDetails.indenterName}</div>
                          <div className="md:col-span-2">
                            <span className="font-medium">Description:</span> {details.purchaseDetails.itemDescription}
                          </div>
                          <div className="md:col-span-2">
                            <span className="font-medium">Bill Details:</span> {details.purchaseDetails.billDetails}
                          </div>
                          <div><span className="font-medium">Total Value:</span> ₹{details.purchaseDetails.totalValue.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Workflow Status */}
                      <div className="bg-green-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3 text-gray-800">Workflow Status</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">Current Stage:</span> {details.workflowStatus.overall}</div>
                          <div><span className="font-medium">Store and Purchase Department Status:</span> {details.workflowStatus.snpStatus}</div>
                          <div><span className="font-medium">Audit Status:</span> 
                            <span className={`ml-2 px-2 py-1 rounded text-xs font-medium ${
                              details.workflowStatus.auditStatus === "Approved" ? "bg-green-100 text-green-800" :
                              details.workflowStatus.auditStatus === "Reject" ? "bg-red-100 text-red-800" :
                              details.workflowStatus.auditStatus === "Hold" ? "bg-yellow-100 text-yellow-800" :
                              "bg-orange-100 text-orange-800"
                            }`}>
                              {details.workflowStatus.auditStatus}
                            </span>
                          </div>
                          <div><span className="font-medium">Finance Status:</span> {details.workflowStatus.financeAdminStatus}</div>
                        </div>
                      </div>

                      {/* Department Remarks */}
                      <div className="bg-yellow-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3 text-gray-800">Department Remarks</h4>
                        <div className="space-y-3">
                          {details.departmentRemarks.snp !== "No remark from Store and Purchase Department" && (
                            <div className="bg-white p-3 rounded border-l-4 border-purple-500">
                              <div className="font-medium text-purple-800">Store and Purchase Department:</div>
                              <div className="text-gray-700 mt-1">{details.departmentRemarks.snp}</div>
                            </div>
                          )}
                          {details.departmentRemarks.audit !== "No remark yet" && (
                            <div className="bg-white p-3 rounded border-l-4 border-green-500">
                              <div className="font-medium text-green-800">Audit Department (Your Remark):</div>
                              <div className="text-gray-700 mt-1">{details.departmentRemarks.audit}</div>
                            </div>
                          )}
                          {details.departmentRemarks.financeAdmin !== "Not reached Finance Admin yet" && (
                            <div className="bg-white p-3 rounded border-l-4 border-gray-300">
                              <div className="font-medium text-gray-600">Finance Admin:</div>
                              <div className="text-gray-500 mt-1 italic">{details.departmentRemarks.financeAdmin}</div>
                            </div>
                          )}
                          {details.departmentRemarks.other !== "No additional remark" && (
                            <div className="bg-white p-3 rounded border-l-4 border-blue-400">
                              <div className="font-medium text-blue-800">Other:</div>
                              <div className="text-gray-700 mt-1">{details.departmentRemarks.other}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Note */}
                      {selectedBillDetails.audit === "Pending" && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                          <div className="flex items-start gap-2">
                            <IconAlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-orange-800">Audit Review Required</p>
                              <p className="text-sm text-orange-700 mt-1">
                                This bill requires your audit review. Please approve to send to Finance Admin, 
                                hold for more information, or reject if audit requirements are not met.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}


