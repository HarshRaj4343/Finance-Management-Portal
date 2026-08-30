"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, money } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole } from "@/lib/roles";
import { signOut, useSession } from "next-auth/react";
import {
  IconArrowLeft,
  IconCheck,
  IconX,
  IconPlayerPause,
  IconClockPause,
  IconHome,
  IconListDetails,
  IconCode,
  IconClock,
  IconSearch,
  IconFilter,
  IconCalendar,
  IconCurrencyRupee,
  IconMapPin,
  IconCategory,
  IconEye,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/* ---------- Interfaces ---------- */
import type { Bill } from "@/types/database";

export default function SnpDashboard() {
  const { data: session,status } = useSession();
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<
    "All" | "Approved" | "Hold" | "Reject" | "Pending"
  >("All");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [jsonViewId, setJsonViewId] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBillDetails, setSelectedBillDetails] = useState<Bill | null>(null);
  

  // Bank guarantee state variables
  const [bankGuaranteeData, setBankGuaranteeData] = useState<Record<string, {
    hasBankGuarantee: boolean;
    bankGuaranteeDetails: string;
    bankGuaranteeAmount: string;
    dateOfInstallation: string;
    dateOfDelivery: string;
  }>>({});

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [amountFilter, setAmountFilter] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const [dateFilter, setDateFilter] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [locationFilter, setLocationFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  
// Access control: Only allow users with employee_type === "Student Purchase"
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return;
    }

    if (session && normaliseRole((session as any).user?.employee_type) !== "Student Purchase") {
      // Not this desk. Send them back to the portal rather than signing
      // them out, which used to lose their session for a mis-click.
      window.location.href = "/";
    }
  }, [status, session]);
  // fetch bills
  useEffect(() => {
    const fetchBills = async () => {
      setLoading(true);
      const { data, error } = await api.get<{ bills: Bill[] }>("/api/bills");
      setLoading(false);
      if (error) {
        setNotice({ kind: "bad", text: error });
        return;
      }
      setBills(data!.bills);
      setFilteredBills(data!.bills);
    };
    fetchBills();
  }, []);

  // Bank guarantee data handlers
  const initializeBankGuaranteeData = (billId: string) => {
    if (!bankGuaranteeData[billId]) {
      setBankGuaranteeData(prev => ({
        ...prev,
        [billId]: {
          hasBankGuarantee: false,
          bankGuaranteeDetails: '',
          bankGuaranteeAmount: '',
          dateOfInstallation: '',
          dateOfDelivery: ''
        }
      }));
    }
  };

  const updateBankGuaranteeData = (billId: string, field: string, value: any) => {
    setBankGuaranteeData(prev => ({
      ...prev,
      [billId]: {
        ...prev[billId],
        [field]: value
      }
    }));
  };

  /**
   * Every decision goes to /api/bills/:id/action, which calls
   * fn_bill_action. That one function checks this desk actually owns the
   * bill, refuses a bill that has already been decided, moves the money,
   * routes it onward and writes the event log -- in one transaction.
   *
   * The role is read from the session on the server, so nothing here can
   * approve a bill this desk is not entitled to approve.
   */
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const act = async (
    bill: Bill,
    action: "Approved" | "Rejected" | "Hold",
    extra?: Record<string, unknown>
  ) => {
    const remark = (remarks[bill.id] ?? "").trim();
    if (action !== "Approved" && !remark) {
      setNotice({
        kind: "bad",
        text: `Write a remark before you ${action === "Rejected" ? "reject" : "hold"} this bill.`,
      });
      return;
    }

    setBusy(bill.id);
    setNotice(null);
    const { data, error } = await api.post<{ bill: Bill }>(
      `/api/bills/${bill.id}/action`,
      { action, remark: remark || undefined, extra }
    );
    setBusy(null);

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }

    setBills((prev) => prev.map((b) => (b.id === bill.id ? { ...b, ...data!.bill } : b)));
    setRemarks((r) => ({ ...r, [bill.id]: "" }));

    setNotice({
      kind: "ok",
      text:
        action === "Approved"
          ? `Bill ${data!.bill.bill_number ?? ""} approved and forwarded to ${data!.bill.status}.`
          : action === "Rejected"
          ? `Bill rejected. ${money(Number(bill.po_value))} has gone back to the applicant's PDA and they have been emailed.`
          : "Bill put on hold. The applicant has been emailed.",
    });
  };

  const handleApprove = async (bill: Bill) => {
    // Bank guarantee details are collected here, at the Student Purchase
    // desk. architecture.jpeg: "Enter Bank Guarantee".
    const bg = bankGuaranteeData[bill.id];
    await act(bill, "Approved", {
      has_bank_guarantee: bg?.hasBankGuarantee ?? false,
      bank_guarantee_details: bg?.hasBankGuarantee ? bg.bankGuaranteeDetails : null,
      bank_guarantee_amount: bg?.hasBankGuarantee ? bg.bankGuaranteeAmount : null,
      date_of_installation: bg?.dateOfInstallation || null,
      date_of_delivery: bg?.dateOfDelivery || null,
    });
  };

  const handleReject = (bill: Bill) => act(bill, "Rejected");
  const handleHold = (bill: Bill) => act(bill, "Hold");

  // Apply filters whenever search criteria change
  useEffect(() => {
    const allowedSnpStatuses = ["Pending", "Hold", "Reject", "Approved"]; // include approved for cards and filters
    // A Consumables bill never comes to this desk, so its snp is null.
    let filtered = bills.filter((b) => b.snp !== null && allowedSnpStatuses.includes(b.snp));

    // Status filter within SNP
    if (activeFilter !== "All") {
      filtered = filtered.filter((b) => b.snp === activeFilter);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((b) =>
        (b.po_details || "").toLowerCase().includes(query) ||
        (b.supplier_name || "").toLowerCase().includes(query) ||
        (b.item_description || "").toLowerCase().includes(query)
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
      filtered = filtered.filter((b) => (b.po_value || 0) >= min && (b.po_value || 0) <= max);
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
        (b.remarks || "").toLowerCase().includes(location) // often contains free text context
      );
    }

    setFilteredBills(filtered);
  }, [bills, activeFilter, searchQuery, categoryFilter, amountFilter, dateFilter, locationFilter]);

  const pendingCount = bills.filter((b) => b.snp === "Pending").length;
  const approvedCount = bills.filter((b) => b.snp === "Approved").length;
  const holdCount = bills.filter((b) => b.snp === "Hold").length;
  const rejectCount = bills.filter((b) => b.snp === "Reject").length;

  const links = [
    {
      label: "All Bills",
      icon: <IconListDetails className="h-5 w-5 shrink-0 text-blue-600" />,
      onClick: () => setActiveFilter("All"),
    },
    {
      label: "Pending Bills",
      icon: <IconClock className="h-5 w-5 shrink-0 text-gray-600" />,
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

  return (
    <div className="flex w-full h-screen bg-white shadow-lg">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {/* Sidebar */}
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="flex flex-col justify-between h-full">
          <div className="flex flex-col">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <button
                  key={idx}
                  onClick={link.onClick}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded text-left w-full transition-colors",
                    activeFilter === link.label.replace(" Bills", "")
                      ? "bg-blue-100 font-medium text-blue-900"
                      : "hover:bg-gray-100"
                  )}
                >
                  {link.icon}
                  {open && <span>{link.label}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom links */}
          <div className="flex flex-col gap-2">

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
            >
              <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700" />
              {open && <span>Logout</span>}
            </button>
          </div>
        </SidebarBody>
      </Sidebar>

      {/* Main Content */}
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-8 overflow-y-auto bg-gray-50">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading Stores and Purchase bills...</span>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center"
            >
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
                Store and Purchase Department
              </h1>
              <p className="text-gray-600 font-medium">
                Bills under Store and Purchase: {pendingCount} pending
              </p>
            </motion.div>

            {/* Search and Filter Section */}
            <div className="bg-white rounded-lg shadow p-4 space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search bills by PO details, supplier, item description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    showFilters ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-gray-100 text-gray-700 border-gray-300"
                  }`}
                >
                  <IconFilter className="h-5 w-5" />
                  Filters
                </button>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("All");
                    setAmountFilter({ min: "", max: "" });
                    setDateFilter({ start: "", end: "" });
                    setLocationFilter("");
                  }}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Clear All
                </button>
              </div>

              {/* Advanced Filters */}
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t"
                  >
                    {/* Category Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <IconCategory className="inline h-4 w-4 mr-1" />
                        Category
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="All">All Categories</option>
                        <option value="Minor">Minor</option>
                        <option value="Major">Major</option>
                        <option value="Consumables">Consumables</option>
                      </select>
                    </div>

                    {/* Amount Range Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <IconCurrencyRupee className="inline h-4 w-4 mr-1" />
                        Amount Range
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          value={amountFilter.min}
                          onChange={(e) => setAmountFilter(prev => ({ ...prev, min: e.target.value }))}
                          className="w-full px-2 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          value={amountFilter.max}
                          onChange={(e) => setAmountFilter(prev => ({ ...prev, max: e.target.value }))}
                          className="w-full px-2 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                    </div>

                    {/* Date Range Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <IconCalendar className="inline h-4 w-4 mr-1" />
                        Date Range
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={dateFilter.start}
                          onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                          className="w-full px-2 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <input
                          type="date"
                          value={dateFilter.end}
                          onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                          className="w-full px-2 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                    </div>

                    {/* Location/Notes Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <IconMapPin className="inline h-4 w-4 mr-1" />
                        Notes contains
                      </label>
                      <input
                        type="text"
                        placeholder="Search in remarks..."
                        value={locationFilter}
                        onChange={(e) => setLocationFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results count */}
              <div className="text-sm text-gray-600">
                Showing {filteredBills.length} of {bills.length} bills
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-500"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Pending</p>
                    <p className="text-2xl font-bold text-orange-600">{pendingCount}</p>
                  </div>
                  <IconClock className="h-8 w-8 text-orange-500" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Approved</p>
                    <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
                  </div>
                  <IconCheck className="h-8 w-8 text-green-500" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white p-4 rounded-lg shadow border-l-4 border-yellow-500"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Hold</p>
                    <p className="text-2xl font-bold text-yellow-600">{holdCount}</p>
                  </div>
                  <IconClockPause className="h-8 w-8 text-yellow-500" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-white p-4 rounded-lg shadow border-l-4 border-red-500"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Rejected</p>
                    <p className="text-2xl font-bold text-red-600">{rejectCount}</p>
                  </div>
                  <IconX className="h-8 w-8 text-red-500" />
                </div>
              </motion.div>
            </div>

            {/* Bills List */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">
                  {activeFilter} Bills - Store and Purchase
                </h2>
              </div>

              {filteredBills.length === 0 ? (
                <div className="text-center py-12">
                  <IconAlertCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">No {activeFilter.toLowerCase()} bills found</p>
                  {(searchQuery || categoryFilter !== "All" || amountFilter.min || amountFilter.max || dateFilter.start || dateFilter.end || locationFilter) && (
                    <p className="text-sm text-gray-400 mt-2">Try adjusting your search or filter criteria</p>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredBills.map((bill, index) => {
                    const isExpanded = expandedBillId === bill.id;
                    const canTakeAction = bill.snp === "Pending" || bill.snp === "Hold";

                    return (
                      <motion.div
                        key={bill.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={cn(
                          "p-4 hover:bg-gray-50 transition-colors",
                          bill.snp === "Approved" && "bg-green-50",
                          bill.snp === "Reject" && "bg-red-50",
                          bill.snp === "Hold" && "bg-yellow-50"
                        )}
                      >
                        {/* Summary Row */}
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 mb-1">
                              {bill.item_description || "No description"}
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                              <div>
                                <span className="font-medium">Supplier:</span> {bill.supplier_name || "N/A"}
                              </div>
                              <div>
                                <span className="font-medium">Amount:</span> ₹{bill.po_value?.toLocaleString()}
                              </div>
                              <div>
                                <span className="font-medium">Category:</span> {bill.item_category || "N/A"}
                              </div>
                              <div>
                                <span className="font-medium">Status:</span> {bill.status || "N/A"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => {
                                setSelectedBillDetails(bill);
                                setShowDetailModal(true);
                              }}
                              className="p-2 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                              title="View Details"
                            >
                              <IconEye size={16} />
                            </button>

                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              bill.snp === "Approved" ? "bg-green-100 text-green-800" :
                              bill.snp === "Reject" ? "bg-red-100 text-red-800" :
                              bill.snp === "Hold" ? "bg-yellow-100 text-yellow-800" :
                              "bg-orange-100 text-orange-800"
                            }`}>
                              {bill.snp || "Pending"}
                            </span>

                            <button
                              onClick={() => setExpandedBillId(isExpanded ? null : bill.id)}
                              className="px-3 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                            >
                              {isExpanded ? "Hide" : "View"}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="mt-4 space-y-4 border-t pt-4"
                            >
                              {/* Additional Details */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div className="bg-gray-50 p-3 rounded">
                                  <p className="font-medium text-gray-700 mb-1">Purchase Details</p>
                                  <p><span className="font-medium">PO:</span> {bill.po_details || "N/A"}</p>
                                  <p><span className="font-medium">Quantity:</span> {bill.qty || 0}</p>
                                  <p><span className="font-medium">Submitted:</span> {bill.created_at ? new Date(bill.created_at).toLocaleDateString() : "N/A"}</p>
                                </div>

                                <div className="space-y-2">
                                  <div className="bg-blue-50 p-3 rounded">
                                    <p className="font-medium text-blue-800 mb-1">Additional Info</p>
                                    <p><span className="font-medium">Description:</span> {bill.item_description || "N/A"}</p>
                                    <p><span className="font-medium">Remark:</span> {bill.remarks || "N/A"}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Bank Guarantee Section */}
                              {canTakeAction && (
                                <div className="bg-purple-50 p-4 rounded-lg space-y-4">
                                  <h4 className="font-medium text-purple-800 mb-3">Bank Guarantee Details</h4>
                                  
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id={`bank-guarantee-${bill.id}`}
                                      checked={bankGuaranteeData[bill.id]?.hasBankGuarantee || false}
                                      onChange={(e) => {
                                        initializeBankGuaranteeData(bill.id);
                                        updateBankGuaranteeData(bill.id, 'hasBankGuarantee', e.target.checked);
                                      }}
                                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                    />
                                    <label htmlFor={`bank-guarantee-${bill.id}`} className="text-sm font-medium text-gray-700">
                                      Bank Guarantee Required
                                    </label>
                                  </div>

                                  {bankGuaranteeData[bill.id]?.hasBankGuarantee && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Bank Guarantee Details
                                        </label>
                                        <textarea
                                          rows={2}
                                          placeholder="Enter bank guarantee details..."
                                          value={bankGuaranteeData[bill.id]?.bankGuaranteeDetails || ''}
                                          onChange={(e) => updateBankGuaranteeData(bill.id, 'bankGuaranteeDetails', e.target.value)}
                                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                                        />
                                      </div>
                                      
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Bank Guarantee Amount (₹)
                                        </label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          value={bankGuaranteeData[bill.id]?.bankGuaranteeAmount || ''}
                                          onChange={(e) => updateBankGuaranteeData(bill.id, 'bankGuaranteeAmount', e.target.value)}
                                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                                        />
                                      </div>
                                      
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Date of Installation
                                        </label>
                                        <input
                                          type="date"
                                          value={bankGuaranteeData[bill.id]?.dateOfInstallation || ''}
                                          onChange={(e) => updateBankGuaranteeData(bill.id, 'dateOfInstallation', e.target.value)}
                                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                                        />
                                      </div>
                                      
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Date of Delivery
                                        </label>
                                        <input
                                          type="date"
                                          value={bankGuaranteeData[bill.id]?.dateOfDelivery || ''}
                                          onChange={(e) => updateBankGuaranteeData(bill.id, 'dateOfDelivery', e.target.value)}
                                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Remark Input & Actions */}
                              {canTakeAction && (
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Add SNP Remark {bill.snp === "Hold" ? "(Update)" : "(Required for Hold/Reject)"}
                                    </label>
                                    <textarea
                                      rows={2}
                                      placeholder="Enter your remark here..."
                                      value={remarks[bill.id] || ""}
                                      onChange={(e) =>
                                        setRemarks((prev) => ({
                                          ...prev,
                                          [bill.id]: e.target.value,
                                        }))
                                      }
                                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                  </div>

                                  <div className="flex gap-3">
                                    <button
                                      onClick={() => handleApprove(bill)}
                                      className="flex items-center gap-1 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                                    >
                                      <IconCheck size={16} />
                                      Approve
                                    </button>
                                    
                                    <button
                                      onClick={() => handleHold(bill)}
                                      className="flex items-center gap-1 px-4 py-2 rounded-lg bg-yellow-500 text-white hover:bg-yellow-600 transition-colors"
                                    >
                                      <IconClockPause size={16} />
                                      Hold
                                    </button>
                                    
                                    <button
                                      onClick={() => handleReject(bill)}
                                      className="flex items-center gap-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                                    >
                                      <IconX size={16} />
                                      Reject
                                    </button>
                                    
                                    <button
                                      onClick={() => setJsonViewId(jsonViewId === bill.id ? null : bill.id)}
                                      className="flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                                    >
                                      <IconCode size={16} /> JSON
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Show actions result for approved/rejected bills */}
                              {!canTakeAction && (
                                <div className={`p-3 rounded-lg ${
                                  bill.snp === "Approved" ? "bg-green-100 text-green-800" :
                                  bill.snp === "Reject" ? "bg-red-100 text-red-800" :
                                  "bg-yellow-50 text-yellow-800"
                                }`}>
                                  <p className="flex items-center gap-2 font-medium">
                                    {bill.snp === "Approved" ? (
                                      <IconCheck className="h-4 w-4 shrink-0" />
                                    ) : bill.snp === "Reject" ? (
                                      <IconX className="h-4 w-4 shrink-0" />
                                    ) : (
                                      <IconPlayerPause className="h-4 w-4 shrink-0" />
                                    )}
                                    {bill.snp === "Approved"
                                      ? "Bill approved"
                                      : bill.snp === "Reject"
                                      ? "Bill rejected by Store and Purchase Department"
                                      : "Bill on Hold by Store and Purchase Department"}
                                  </p>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Sidebar Logos ------------------------- */
const Logo = () => (
  <a
    href="#"
    className="relative z-20 flex items-center space-x-2 py-1 text-base font-semibold text-black"
  >
    <img src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="whitespace-pre text-black"
    >
      Store and Purchase
    </motion.span>
  </a>
);

const LogoIcon = () => (
  <a
    href="#"
    className="relative z-20 flex items-center py-1 text-sm font-semibold text-black"
  >
    <img src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
  </a>
);
