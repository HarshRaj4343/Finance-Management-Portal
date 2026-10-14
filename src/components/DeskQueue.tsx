"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { IconAlertCircle, IconCheck, IconClock, IconClockPause, IconListDetails, IconX } from "@tabler/icons-react";
import AppShell, { type NavItem } from "./AppShell";
import BillCard from "./BillCard";
import DeskReviewPanel from "./DeskReviewPanel";
import SnpReviewPanel from "./SnpReviewPanel";
import FilterBar, { FilterField, filterInput } from "./FilterBar";
import Notice, { type NoticeState } from "./Notice";
import { EmptyState, LoadingState, PageHeader, StatCard, StatGrid } from "./ui/page";
import { api } from "@/lib/api";
import { deskLabel, normaliseRole, type Stage } from "@/lib/roles";
import { canReviewDesk, canReviewSnp, istDay, latestArrivalFirst } from "@/lib/bill-review";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import type { Bill } from "@/types/database";

export type DeskFilter = "Pending" | "Approved" | "Hold" | "Reject" | "All";

/** Which column records this desk's decision on a bill. */
const STATE_KEY: Record<Stage, "snp" | "audit" | "finance_admin"> = {
  "Student Purchase": "snp",
  "Audit": "audit",
  "Finance Admin": "finance_admin",
};

const SECTIONS: { filter: DeskFilter; label: string; icon: ReactNode }[] = [
  { filter: "Pending", label: "Pending Bills", icon: <IconClock /> },
  { filter: "Approved", label: "Approved Bills", icon: <IconCheck /> },
  { filter: "Hold", label: "Hold Bills", icon: <IconClockPause /> },
  { filter: "Reject", label: "Rejected Bills", icon: <IconX /> },
  { filter: "All", label: "All", icon: <IconListDetails /> },
];

/**
 * The one page every approval desk uses: the same sections, counts,
 * filters, ordering (most recent arrival first), live refresh and
 * decision controls. Pages differ only in their desk and wording.
 */
export default function DeskQueue({ desk, title, description, hints, extraNav = [], extraView }: {
  desk: Stage;
  title: string;
  description: string;
  /** Stat-card hints per section. */
  hints: Record<DeskFilter, string>;
  /** Desk-specific sections after the standard ones (e.g. Manage Employees). */
  extraNav?: (NavItem & { key: string })[];
  /** Renders a desk-specific section instead of the queue when it is selected. */
  extraView?: (key: string, notify: (notice: NoticeState) => void) => ReactNode;
}) {
  const { data: session, status } = useSession();
  const role = normaliseRole(session?.user?.employee_type);
  const ready = status === "authenticated" && role === desk;
  const key = STATE_KEY[desk];

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [section, setSection] = useState<DeskFilter | string>("Pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [amountFilter, setAmountFilter] = useState({ min: "", max: "" });
  const [dateFilter, setDateFilter] = useState({ start: "", end: "" });
  const [locationFilter, setLocationFilter] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    // Not this desk: back to the portal, which routes by role.
    else if (status === "authenticated" && role !== desk) window.location.href = "/";
  }, [status, role, desk]);

  const fetchBills = useCallback(async (silent = false) => {
    if (!ready) return;
    if (!silent) setLoading(true);
    const { data, error } = await api.bills<{ bills: Bill[] }>("/api/bills?limit=500");
    if (!silent) setLoading(false);
    if (error) { if (!silent) setNotice({ kind: "bad", text: error }); return; }
    // Bills this desk has a stake in: sitting here now, or carrying its decision.
    setBills(data!.bills.filter((b) => b.status === desk || b[key] !== null));
  }, [ready, desk, key]);
  useEffect(() => { fetchBills(); }, [fetchBills]);
  // New arrivals appear without a reload.
  useLiveRefresh(() => fetchBills(true));

  const counts = useMemo(() => ({
    All: bills.length,
    Pending: bills.filter((b) => b[key] === "Pending").length,
    Approved: bills.filter((b) => b[key] === "Approved").length,
    Hold: bills.filter((b) => b[key] === "Hold").length,
    Reject: bills.filter((b) => b[key] === "Reject").length,
  }), [bills, key]);

  const filtersActive = Boolean(searchQuery || categoryFilter !== "All" || amountFilter.min || amountFilter.max || dateFilter.start || dateFilter.end || locationFilter);
  const clearFilters = () => {
    setSearchQuery(""); setCategoryFilter("All"); setAmountFilter({ min: "", max: "" }); setDateFilter({ start: "", end: "" }); setLocationFilter("");
  };

  const queueFilter = SECTIONS.some((s) => s.filter === section) ? (section as DeskFilter) : null;
  const shown = useMemo(() => {
    if (!queueFilter) return [];
    const q = searchQuery.trim().toLowerCase();
    const loc = locationFilter.trim().toLowerCase();
    const min = amountFilter.min ? parseFloat(amountFilter.min) : -Infinity;
    const max = amountFilter.max ? parseFloat(amountFilter.max) : Infinity;
    return bills
      .filter((b) => queueFilter === "All" || b[key] === queueFilter)
      .filter((b) => !q || [b.bill_number, b.po_details, b.supplier_name, b.employee_name, b.employee_id, b.item_description, b.bill_details, b.indenter_name]
        .some((v) => (v ?? "").toLowerCase().includes(q)))
      .filter((b) => categoryFilter === "All" || b.item_category === categoryFilter)
      .filter((b) => (b.po_value ?? 0) >= min && (b.po_value ?? 0) <= max)
      .filter((b) => {
        if (!dateFilter.start && !dateFilter.end) return true;
        const day = istDay(b.created_at);
        return Boolean(day) && (!dateFilter.start || day! >= dateFilter.start) && (!dateFilter.end || day! <= dateFilter.end);
      })
      .filter((b) => !loc || [b.location, b.supplier_address].some((v) => (v ?? "").toLowerCase().includes(loc)))
      .sort(latestArrivalFirst);
  }, [bills, queueFilter, key, searchQuery, categoryFilter, amountFilter, dateFilter, locationFilter]);

  const replace = (updated: Bill) => setBills((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
  const canDecide = (bill: Bill) => desk === "Student Purchase"
    ? canReviewSnp(bill, session?.user?.employee_code, session?.user?.employee_type)
    : canReviewDesk(bill, desk, session?.user?.employee_code, session?.user?.employee_type);

  if (!ready) return null;

  const nav: NavItem[] = [
    ...SECTIONS.map((s) => ({ label: s.label, icon: s.icon, onClick: () => setSection(s.filter), active: section === s.filter, badge: counts[s.filter] || null })),
    ...extraNav.map((n) => ({ ...n, onClick: () => setSection(n.key), active: section === n.key })),
  ];
  const sectionLabel = SECTIONS.find((s) => s.filter === queueFilter)?.label ?? "";

  return (
    <AppShell desk={deskLabel(desk)} nav={nav}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {!queueFilter && extraView ? extraView(section, setNotice) : (
        <>
          <PageHeader title={title} description={`${description} ${counts.Pending} pending.`} />
          {loading ? <LoadingState label="Loading bills…" /> : (
            <>
              <StatGrid>
                <StatCard label="Pending" value={counts.Pending} hint={hints.Pending} tone="blue" icon={<IconClock />} onClick={() => setSection("Pending")} active={queueFilter === "Pending"} />
                <StatCard label="Approved" value={counts.Approved} hint={hints.Approved} tone="green" icon={<IconCheck />} onClick={() => setSection("Approved")} active={queueFilter === "Approved"} />
                <StatCard label="Hold" value={counts.Hold} hint={hints.Hold} tone="amber" icon={<IconClockPause />} onClick={() => setSection("Hold")} active={queueFilter === "Hold"} />
                <StatCard label="Rejected" value={counts.Reject} hint={hints.Reject} tone="red" icon={<IconX />} onClick={() => setSection("Reject")} active={queueFilter === "Reject"} />
                <StatCard label="All" value={counts.All} hint={hints.All} icon={<IconListDetails />} onClick={() => setSection("All")} active={queueFilter === "All"} />
              </StatGrid>

              <FilterBar
                search={searchQuery}
                onSearch={setSearchQuery}
                placeholder="Search by bill number, PO, supplier, employee or item"
                onClear={clearFilters}
                active={filtersActive}
                summary={`${sectionLabel}: showing ${shown.length} of ${queueFilter === "All" ? counts.All : counts[queueFilter!]}, most recent first`}
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
                    <input type="number" placeholder="Min" value={amountFilter.min} onChange={(e) => setAmountFilter((p) => ({ ...p, min: e.target.value }))} className={filterInput} />
                    <input type="number" placeholder="Max" value={amountFilter.max} onChange={(e) => setAmountFilter((p) => ({ ...p, max: e.target.value }))} className={filterInput} />
                  </div>
                </FilterField>
                <FilterField label="Filed between">
                  <div className="flex gap-2">
                    <input type="date" aria-label="From" value={dateFilter.start} onChange={(e) => setDateFilter((p) => ({ ...p, start: e.target.value }))} className={filterInput} />
                    <input type="date" aria-label="To" value={dateFilter.end} onChange={(e) => setDateFilter((p) => ({ ...p, end: e.target.value }))} className={filterInput} />
                  </div>
                </FilterField>
                <FilterField label="Location">
                  <input type="text" placeholder="Building, room or address" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className={filterInput} />
                </FilterField>
              </FilterBar>

              {shown.length === 0 ? (
                <EmptyState
                  icon={<IconAlertCircle />}
                  title={queueFilter === "Pending" ? "Nothing waiting for you" : `No ${sectionLabel.toLowerCase()} found`}
                  description={filtersActive ? "Try adjusting your search or filters." : undefined}
                />
              ) : (
                <div className="space-y-4">
                  {shown.map((bill) => (
                    <BillCard key={bill.id} bill={bill} showBankGuarantee={desk === "Audit" || (desk === "Student Purchase" && bill.snp === "Approved")}>
                      {canDecide(bill) ? (
                        desk === "Student Purchase" ? (
                          <SnpReviewPanel bill={bill} actorCode={session?.user?.employee_code} actorRole={session?.user?.employee_type}
                            onDecided={(updated) => replace(updated)} />
                        ) : (
                          <DeskReviewPanel bill={bill} desk={desk} actorCode={session?.user?.employee_code} actorRole={session?.user?.employee_type}
                            onDecided={(updated, text) => { replace(updated); setNotice({ kind: "ok", text }); }} />
                        )
                      ) : (
                        <p className={`flex items-center gap-2 text-sm font-medium ${bill[key] === "Approved" ? "text-green-800" : bill[key] === "Reject" ? "text-red-800" : "text-slate-600"}`}>
                          {bill[key] === "Approved" ? <IconCheck className="size-4" /> : bill[key] === "Reject" ? <IconX className="size-4" /> : null}
                          {bill[key] === "Approved"
                            ? bill.status === "Accepted" ? `Approved by ${deskLabel(desk)}. Final approval complete.` : `Approved by ${deskLabel(desk)}. Now with ${deskLabel(bill.status)}.`
                            : bill[key] === "Reject" ? `Rejected by ${deskLabel(desk)}.`
                            : bill.status === desk ? "Waiting at this desk." : `With ${deskLabel(bill.status)}.`}
                        </p>
                      )}
                    </BillCard>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
