"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import SnpReviewPanel from "@/components/SnpReviewPanel";
import BillCard from "@/components/BillCard";
import AppShell from "@/components/AppShell";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { EmptyState, LoadingState, PageHeader, StatCard, StatGrid } from "@/components/ui/page";
import { latestArrivalFirst } from "@/lib/bill-review";
import Notice from "@/components/Notice";
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

/* ---------- Interfaces ---------- */
import type { Bill } from "@/types/database";

export default function SnpDashboard() {
  const { data: session,status } = useSession();
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<
    "All" | "Approved" | "Hold" | "Reject" | "Pending"
  >("All");
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [amountFilter, setAmountFilter] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const [dateFilter, setDateFilter] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [locationFilter, setLocationFilter] = useState("");
  
// Access control: Only allow users with employee_type === "Student Purchase"
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return;
    }

    if (session && normaliseRole(session.user?.employee_type) !== "Student Purchase") {
      // Not this desk. Send them back to the portal rather than signing
      // them out, which used to lose their session for a mis-click.
      window.location.href = "/";
    }
  }, [status, session]);
  // fetch bills
  useEffect(() => {
    const fetchBills = async () => {
      setLoading(true);
      const { data, error } = await api.bills<{ bills: Bill[] }>("/api/bills?limit=500");
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

  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

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

    // Newest arrival at this desk first.
    setFilteredBills([...filtered].sort(latestArrivalFirst));
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

  const filtersActive = Boolean(searchQuery || categoryFilter !== "All" || amountFilter.min || amountFilter.max || dateFilter.start || dateFilter.end || locationFilter);
  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("All");
    setAmountFilter({ min: "", max: "" });
    setDateFilter({ start: "", end: "" });
    setLocationFilter("");
  };
  const counts: Record<string, number> = { All: bills.length, Pending: pendingCount, Approved: approvedCount, Hold: holdCount, Reject: rejectCount };

  return (
    <AppShell
      desk="Store and Purchase Department"
      nav={links.map((link) => {
        const key = link.label.replace(" Bills", "");
        const filter = key === "Rejected" ? "Reject" : key;
        return { label: link.label === "All Bills" ? "All" : link.label, icon: link.icon, onClick: link.onClick, active: activeFilter === filter, badge: counts[filter] ?? null };
      })}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader title="Store and Purchase Department" description={`Major and minor purchases are checked here first. ${pendingCount} waiting.`} />

      {loading ? <LoadingState label="Loading Store and Purchase bills…" /> : (
        <>
          <StatGrid>
            <StatCard label="Pending" value={pendingCount} hint="Waiting for you" tone="blue" icon={<IconClock />} onClick={() => setActiveFilter("Pending")} active={activeFilter === "Pending"} />
            <StatCard label="Approved" value={approvedCount} hint="Sent on" tone="green" icon={<IconCheck />} onClick={() => setActiveFilter("Approved")} active={activeFilter === "Approved"} />
            <StatCard label="Hold" value={holdCount} hint="Waiting for correction" tone="amber" icon={<IconClockPause />} onClick={() => setActiveFilter("Hold")} active={activeFilter === "Hold"} />
            <StatCard label="Rejected" value={rejectCount} hint="Funds released" tone="red" icon={<IconX />} onClick={() => setActiveFilter("Reject")} active={activeFilter === "Reject"} />
            <StatCard label="All" value={bills.length} hint="Every bill at this desk" icon={<IconListDetails />} onClick={() => setActiveFilter("All")} active={activeFilter === "All"} />
          </StatGrid>

          <FilterBar
            search={searchQuery}
            onSearch={setSearchQuery}
            placeholder="Search by PO, supplier or item"
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
                const canTakeAction = bill.status === "Student Purchase" && (bill.snp === "Pending" || bill.snp === "Hold");
                return (
                  <BillCard key={bill.id} bill={bill} showBankGuarantee={bill.snp === "Approved"}>
                    {canTakeAction ? (
                      <SnpReviewPanel bill={bill} actorCode={session?.user?.employee_code}
                        actorRole={session?.user?.employee_type} onDecided={(updated) => {
                          setBills((current) => current.map((b) => b.id === updated.id ? updated : b));
                        }} />
                    ) : (
                      <p className={`flex items-center gap-2 text-sm font-medium ${bill.snp === "Approved" ? "text-green-800" : bill.snp === "Reject" ? "text-red-800" : "text-slate-600"}`}>
                        {bill.snp === "Approved" ? <IconCheck className="size-4" /> : bill.snp === "Reject" ? <IconX className="size-4" /> : null}
                        {bill.snp === "Approved" ? `Approved by Store and Purchase. Now with ${deskLabel(bill.status)}.`
                          : bill.snp === "Reject" ? "Rejected by Store and Purchase Department."
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
    </AppShell>
  );
}


