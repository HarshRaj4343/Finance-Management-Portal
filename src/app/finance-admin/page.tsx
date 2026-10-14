"use client";
import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api, money } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole, deskLabel } from "@/lib/roles";
import {
  IconEye,
  IconUsers,
  IconList,
  IconHistory,
  IconClockPause,
  IconFileText,
  IconCheck,
  IconX,
  IconEdit,
  IconTrash,
  IconPlus,
} from "@tabler/icons-react";
import AppShell from "@/components/AppShell";
import DeskReviewPanel from "@/components/DeskReviewPanel";
import { EmptyState, LoadingState, PageHeader, Panel, StatCard, StatGrid, StatusBadge } from "@/components/ui/page";
import EditEmployeeForm from "@/components/EditEmployeeForm";
import BillCard from "@/components/BillCard";
import { useConfirm } from "@/components/ConfirmProvider";
import { canReviewDesk, latestArrivalFirst } from "@/lib/bill-review";

// Allowed departments
const DEPARTMENTS = [
  "Staff Recruitment Section",
  "Dean Infrastructure (I&S)/Land Acquisition",
  "Dean Resource Generation & Alumni Relations",
  "Central Dak Section",
  "Health Center",
  "School of Computing & Electrical Engineering",
  "School of Chemical Sciences",
  "School of Physical Sciences",
  "School of Mathematical & Statistical Sciences",
  "School of Biosciences & Bio Engineering",
  "School of Mechanical & Materials Engineering",
  "School of Civil & Environmental Engineering",
  "School of Humanities & Social Sciences",
  "School of Management",
  "Advanced Materials Research Center (AMRC)",
  "Centre of Artificial Intelligence and Robotics (CAIR)",
  "Center for Quantum Science and Technologies (CQST)",
  "Centre for Design & Fabrication of Electronic Devices (C4DFED)",
  "Center for Human-Computer Interaction (CHCI)",
  "Center for Climate Change and Disaster Management (C3DAR)",
  "IIT Mandi i-Hub & HCI",
  "IKSMHA Center",
  "Centre for Continuing Education (CCE)",
  "JEE CELL",
  "JAM",
  "GATE",
  "Office of Chief Warden",
  "Parashar Hostel",
  "Chandertaal Hostel",
  "Suvalsar Hostel",
  "Nako Hostel",
  "Dashir Hostel",
  "Beas Kund Hostel",
  "Manimahesh Hostel",
  "Suraj Taal Hostel",
  "Gauri Kund Hostel",
  "Central Mess",
  "Sports",
  "NSS",
  "Guidance & Counselling Cell",
  "Construction & Maintainance Cell",
  "Transportation",
  "Guest House",
  "Housekeeping Services & Waste Management",
  "Creche",
  "Security Unit",
  "Common Rooms",
  "Career & Placement Cell",
  "IIT Mandi Catalyst",
  "Recreation Center",
  "CPWD",
  "Banks",
  "IPDC",
  "IR",
  "Mind Tree School",
  "Renuka Hostel",
  "Rewalsar",
  "Director Office",
  "Deans",
  "Associate Deans",
  "Registrar Office",
  "Administration and Establishment Section",
  "Faculty Establishment and Recruitment",
  "Finance and Accounts",
  "Store and Purchase Section",
  "Rajbhasa Section",
  "Ranking Cell (RC)",
  "Media Cell",
  "Academics Section",
  "Academic Affairs",
  "Research Affairs",
  "Legal Section",
  "Internal Audit",
  "Central Library",
  "DIGITAL AND COMPUTING SERVICES",
  "Dean (SRIC & IR ) Office",
  "Dean (Students) Office",
];

/* ---------- Interfaces ---------- */
import type { Bill } from "@/types/database";

import type { Employee } from "@/types/database";

type PageView = "dashboard" | "review-bills" | "hold-bills" | "history" | "employees";

export default function FinanceAdminDashboard() {
  const { data: session,status} = useSession();
  const confirm = useConfirm();

  const [bills, setBills] = useState<Bill[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [activePage, setActivePage] = useState<PageView>("dashboard");
  // Bill History filter by the Finance Admin decision: "" shows every bill.
  const [historyFilter, setHistoryFilter] = useState<"" | "Approved" | "Reject">("");
  const openHistory = (filter: "" | "Approved" | "Reject") => { setHistoryFilter(filter); setActivePage("history"); };

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // for bill actions
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBillDetails, setSelectedBillDetails] = useState<Bill | null>(null);

  // Add employee form
  const [showAddEmployeeForm, setShowAddEmployeeForm] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    employee_name: "",
    email: "",
    employee_type: "User",
    department: "Finance and Accounts",
    employee_code: "",
  });

  //const FINANCE_ADMIN_PASSWORD = "admin123"; // In production, this should be in environment variables
  useEffect(() => {
      if (status === "loading") return;
  
      if (status === "unauthenticated") {
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return;
      }
  
      if (session && normaliseRole(session.user?.employee_type) !== "Finance Admin") {
        window.location.href = "/";
      }
    }, [status, session]);
  const [notice, setNotice] = useState<NoticeState>(null);

  // Bills. The server scopes what this role may see; the browser no longer
  // pulls the whole table down and filters it in React.
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
    };
    fetchBills();
  }, []);

  // The employee directory, newest first.
  const fetchEmployees = async () => {
    const { data, error } = await api.get<{ employees: Employee[] }>(
      "/api/admin/employees"
    );
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setEmployees(
      [...data!.employees].sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )
    );
  };

  useEffect(() => {
    if (activePage === "employees") fetchEmployees();
  }, [activePage]);

  const handleSaveEmployee = async (updatedEmployee: Employee) => {
    if (!updatedEmployee?.employee_code) {
      setNotice({ kind: "bad", text: "That record has no employee code, so it cannot be saved." });
      return;
    }
    if (!(await confirm({
      title: "Save these employee details?",
      details: [["Employee", `${updatedEmployee.employee_name} (${updatedEmployee.employee_code})`], ["Email", updatedEmployee.email], ["Department", updatedEmployee.department ?? "—"]],
      confirmLabel: "Save changes",
    }))) return;

    const { data, error } = await api.patch<{ employee: Employee }>(
      `/api/admin/employees/${encodeURIComponent(updatedEmployee.employee_code)}`,
      {
        employee_name: updatedEmployee.employee_name,
        email: updatedEmployee.email,
        department: normalizeDepartment(updatedEmployee.department),
      }
    );

    if (error) {
      // Includes "only the Dean of Finance can change somebody's role",
      // which is a rule rather than a failure -- so it is shown as-is.
      setNotice({ kind: "bad", text: error });
      return;
    }

    setEmployees((prev) =>
      prev.map((e) => (e.employee_code === data!.employee.employee_code ? data!.employee : e))
    );
    setEditingEmployee(null);
    setNotice({ kind: "ok", text: `${data!.employee.employee_name} updated.` });
  };

  /* ---------- Directory actions: server permissions are authoritative ---------- */
  const handleDirectoryAction = (action: string, code?: string) => {
    if (action === "add") setShowAddEmployeeForm(true);
    if (action === "edit") setEditingEmployee(employees.find((e) => e.employee_code === code) ?? null);
    if (action === "delete" && code) void handleDeleteEmployee(code);
  };

  /* ---------- Bill Actions ---------- */
  /**
   * This is the last desk. Approving here ends the workflow: the money
   * moves from committed to spent and the purchase is entered in the
   * departmental register under a fresh serial number. All of it happens
   * inside fn_bill_action, so a bill can never be marked Accepted without
   * its register entry, or vice versa.
   */



  /* ---------- Employee Actions ---------- */
  /**
   * Deactivate rather than delete. Bills, register entries and the event
   * log all name the person who filed or approved them; deleting the row
   * would orphan records that are meant to be permanent.
   */
  const handleDeleteEmployee = async (code: string) => {
    if (!(await confirm({
      title: "Deactivate this employee?",
      description: "They will no longer be able to sign in. Their financial history will be kept.",
      details: [["Employee", code]],
      confirmLabel: "Deactivate",
      tone: "danger",
    }))) return;
    const { data, error } = await api.del<{ employee: Employee; note: string }>(
      `/api/admin/employees/${encodeURIComponent(code)}`
    );
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setEmployees((prev) =>
      prev.map((e) => (e.employee_code === code ? { ...e, is_active: false } : e))
    );
    setNotice({ kind: "ok", text: data!.note });
  };

  const handleNewEmployeeChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setNewEmployee((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newEmployee.employee_name || !newEmployee.email || !newEmployee.employee_code) {
      setNotice({ kind: "bad", text: "A name, an email address and an employee code are all required." });
      return;
    }
    if (!(await confirm({
      title: "Add this employee?",
      details: [["Name", newEmployee.employee_name], ["Code", newEmployee.employee_code], ["Email", newEmployee.email], ["Department", newEmployee.department], ["Role", "User"]],
      confirmLabel: "Add employee",
    }))) return;

    const { data, error } = await api.post<{ employee: Employee; note: string | null }>(
      "/api/admin/employees",
      {
        employee_name: newEmployee.employee_name,
        email: newEmployee.email,
        employee_type: newEmployee.employee_type,
        department: normalizeDepartment(newEmployee.department),
        employee_code: newEmployee.employee_code,
      }
    );

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }

    await fetchEmployees();
    setNewEmployee({
      employee_name: "",
      email: "",
      employee_type: "User",
      department: "Finance and Accounts",
      employee_code: "",
    });
    setShowAddEmployeeForm(false);
    setNotice({
      kind: data!.note ? "info" : "ok",
      text: data!.note ?? `${data!.employee.employee_name} added.`,
    });
  };

  /* ---------- Stats ---------- */
  const totalBills = bills.length;
  const approvedCount = bills.filter((b) => b.finance_admin === "Approved").length;
  const holdCount = bills.filter((b) => b.finance_admin === "Hold").length;
  const rejectCount = bills.filter((b) => b.finance_admin === "Reject").length;
  const pendingCount = bills.filter((b) => b.finance_admin === "Pending").length;

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
        itemDescription: bill.item_description || "N/A",
        itemCategory: bill.item_category || "N/A",
        quantity: bill.qty || 0,
        totalValue: bill.po_value || 0,
      },
      workflowStatus: {
        overall: deskLabel(bill.status),
        snpStatus: bill.snp || "N/A",
        auditStatus: bill.audit || "N/A",
        financeAdminStatus: bill.finance_admin || "N/A",
      },
      departmentRemarks: {
        snp: bill.remarks1 || "No remark",
        audit: bill.remarks2 || "No remark", 
        financeAdmin: bill.remarks || "No remark",
        other: bill.remarks3 || "No remark",
        additional: bill.remarks4 || "No remark",
      }
    };
  };

  const reviewQueue = bills
    .filter((bill) =>
      bill.finance_admin === "Pending" ||
      bill.finance_admin === "Hold" ||
      (bill.status === "Finance Admin" && (bill.finance_admin === null || bill.finance_admin === undefined))
    )
    // Newest arrival at this desk first, e.g. a bill Store and Purchase just approved.
    .sort(latestArrivalFirst);
  const heldBills = bills.filter((b) => b.snp === "Hold" || b.audit === "Hold" || b.finance_admin === "Hold");
  const th = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

  return (
    <AppShell
      desk="Finance Admin"
      nav={[
        { label: "Dashboard", icon: <IconList />, onClick: () => setActivePage("dashboard"), active: activePage === "dashboard" },
        { label: "Review Bills", icon: <IconFileText />, onClick: () => setActivePage("review-bills"), active: activePage === "review-bills", badge: reviewQueue.length || null },
        { label: "Hold Bills", icon: <IconClockPause />, onClick: () => setActivePage("hold-bills"), active: activePage === "hold-bills", badge: heldBills.length || null },
        { label: "Bill History", icon: <IconHistory />, onClick: () => openHistory(""), active: activePage === "history" },
        { label: "Manage Employees", icon: <IconUsers />, onClick: () => setActivePage("employees"), active: activePage === "employees" },
      ]}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {activePage === "dashboard" && (
        <>
          <PageHeader title="Finance Admin" description="Final approval desk. Approving here debits the PDA and enters the purchase in the register." />
          <StatGrid>
            <StatCard label="Total Bills" value={totalBills} hint="All submissions" onClick={() => openHistory("")} />
            <StatCard label="Approved" value={approvedCount} hint="Ready for payment" tone="green" onClick={() => openHistory("Approved")} />
            <StatCard label="Hold" value={holdCount} hint="Needs attention" tone="amber" onClick={() => setActivePage("hold-bills")} />
            <StatCard label="Rejected" value={rejectCount} hint="Not approved" tone="red" onClick={() => openHistory("Reject")} />
            <StatCard label="Pending" value={pendingCount} hint="Awaiting review" tone="blue" onClick={() => setActivePage("review-bills")} />
          </StatGrid>
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Recent bills</h2>
            {loading ? <LoadingState label="Loading bills…" /> : bills.length === 0 ? (
              <EmptyState title="No bills yet" />
            ) : (
              bills.slice(0, 5).map((bill) => <BillCard key={bill.id} bill={bill} showBankGuarantee={false} />)
            )}
          </section>
        </>
      )}

      {activePage === "review-bills" && (
        <>
          <PageHeader title="Review Bills" description="Bills waiting at Finance Admin, the most recent arrival first." />
          {loading ? <LoadingState label="Loading bills…" /> : reviewQueue.length === 0 ? (
            <EmptyState icon={<IconCheck />} title="Nothing to review" description="Bills appear here once they reach Finance Admin." />
          ) : (
            <div className="space-y-4">
              {reviewQueue.map((bill) => {
                const locked = !canReviewDesk(bill, "Finance Admin", session?.user?.employee_code, session?.user?.employee_type);
                return (
                  <BillCard key={bill.id} bill={bill} showBankGuarantee={false}>
                    {!locked && (
                      <DeskReviewPanel
                        bill={bill}
                        desk="Finance Admin"
                        actorCode={session?.user?.employee_code}
                        actorRole={session?.user?.employee_type}
                        onDecided={(updated, text) => {
                          setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
                          setNotice({ kind: "ok", text });
                        }}
                      />
                    )}
                  </BillCard>
                );
              })}
            </div>
          )}
        </>
      )}

      {activePage === "hold-bills" && (
        <>
          <PageHeader title="Hold Bills" description="Bills on hold at any desk, waiting for the filer to correct them." />
          {heldBills.length === 0 ? (
            <EmptyState icon={<IconClockPause />} title="No bills on hold" />
          ) : (
            <Panel bodyClassName="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Bill</th>
                    <th className={th}>Employee</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Held by</th>
                    <th className={th}>Remark</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {heldBills.map((bill) => {
                    const holdDepartment =
                      bill.finance_admin === "Hold" ? "Finance Admin" :
                      bill.audit === "Hold" ? "Audit" :
                      bill.snp === "Hold" ? "Store and Purchase Department" : "Unknown";
                    const holdRemark =
                      bill.finance_admin === "Hold" ? bill.remarks :
                      bill.audit === "Hold" ? bill.remarks2 :
                      bill.snp === "Hold" ? bill.remarks1 : null;
                    return (
                      <tr key={bill.id} className="hover:bg-slate-50">
                        <td className="max-w-xs px-4 py-3">
                          <p className="truncate font-medium text-slate-900">{bill.item_description || "No description"}</p>
                          <p className="truncate text-xs text-slate-500">{bill.bill_number} · {bill.supplier_name}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{bill.employee_name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bill.po_value)}</td>
                        <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={holdDepartment} /></td>
                        <td className="max-w-xs px-4 py-3 text-slate-700">{holdRemark || "No remark"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            onClick={() => { setSelectedBillDetails(bill); setShowDetailModal(true); }}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50"
                          >
                            <IconEye size={16} /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}

      {activePage === "history" && (
        <>
          <PageHeader title="Bill History" description="Every bill visible to Finance Admin, filtered by the Finance Admin decision." />
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Finance Admin decision">
            {([["", "All"], ["Approved", "Approved"], ["Reject", "Rejected"]] as const).map(([value, label]) => (
              <button key={label} role="tab" aria-selected={historyFilter === value} onClick={() => setHistoryFilter(value)}
                className={`inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium ${historyFilter === value ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                {label}
                <span className="ml-2 rounded-full bg-white/70 px-1.5 text-xs tabular-nums">
                  {value ? bills.filter((b) => b.finance_admin === value).length : bills.length}
                </span>
              </button>
            ))}
          </div>
          {(() => {
            const rows = historyFilter ? bills.filter((b) => b.finance_admin === historyFilter) : bills;
            return rows.length === 0 ? <EmptyState title="No bills here" /> : (
              <Panel bodyClassName="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>Bill</th>
                      <th className={th}>Employee</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={th}>Status</th>
                      <th className={th}>Finance Admin</th>
                      <th className={th}>Filed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((bill) => (
                      <tr key={bill.id} className="hover:bg-slate-50">
                        <td className="max-w-xs px-4 py-3">
                          <a href={`/bill/${bill.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-blue-700 hover:underline">{bill.bill_number ?? bill.id.slice(0, 8)}</a>
                          <p className="truncate text-slate-700">{bill.item_description || "No description"}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{bill.employee_name} <span className="text-xs text-slate-500">({bill.employee_id})</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bill.po_value)}</td>
                        <td className="px-4 py-3"><StatusBadge value={bill.status} /></td>
                        <td className="px-4 py-3"><StatusBadge value={bill.finance_admin} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(bill.created_at).toLocaleDateString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })()}
        </>
      )}

      {activePage === "employees" && (
        <>
          <PageHeader
            title="Manage Employees"
            description="Add people and correct their details. Only the Dean assigns workflow roles."
            actions={
              <button onClick={() => handleDirectoryAction("add")}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
                <IconPlus size={18} /> Add Employee
              </button>
            }
          />
          <Panel bodyClassName="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Employee</th>
                  <th className={th}>Email</th>
                  <th className={th}>Role</th>
                  <th className={th}>Department</th>
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-medium text-slate-900">{emp.employee_name}</p>
                      <p className="text-xs text-slate-500">{emp.employee_code ?? "—"}{emp.is_active === false && " · Deactivated"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{emp.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{deskLabel(emp.employee_type)}</td>
                    <td className="px-4 py-3 text-slate-700">{emp.department}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => handleDirectoryAction("edit", emp.employee_code)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50">
                        <IconEdit size={16} /> Edit
                      </button>
                      <button onClick={() => handleDirectoryAction("delete", emp.employee_code)}
                        className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-red-700 hover:bg-red-50">
                        <IconTrash size={16} /> Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {/* Add Employee Modal */}
      <AnimatePresence>
        {showAddEmployeeForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 flex justify-center items-center z-50"
          >
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -50, opacity: 0 }}
              className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md"
            >
              <h2 className="text-3xl font-bold mb-6 text-gray-800">Add New Employee</h2>
              <form onSubmit={handleAddEmployee} className="space-y-6">
                <div>
                  <label htmlFor="employee_name" className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    id="employee_name"
                    name="employee_name"
                    value={newEmployee.employee_name}
                    onChange={handleNewEmployeeChange}
                    className="mt-1 block w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={newEmployee.email}
                    onChange={handleNewEmployeeChange}
                    className="mt-1 block w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="employee_type" className="block text-sm font-medium text-gray-700">Employee Type</label>
                  <input id="employee_type" value="User" readOnly className="mt-1 block w-full p-3 bg-gray-50 border rounded-md" />
                  <p className="text-xs text-gray-500 mt-1">Only the Dean can assign workflow roles.</p>
                </div>
                <div>
                  <label htmlFor="department" className="block text-sm font-medium text-gray-700">Department</label>
                  <select
                    id="department"
                    name="department"
                    value={newEmployee.department}
                    onChange={handleNewEmployeeChange}
                    className="mt-1 block w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="employee_code" className="block text-sm font-medium text-gray-700">Employee Code</label>
                  <input
                    type="text"
                    id="employee_code"
                    name="employee_code"
                    value={newEmployee.employee_code}
                    onChange={handleNewEmployeeChange}
                    className="mt-1 block w-full px-4 py-3 bg-gray-50 aorder border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddEmployeeForm(false)}
                    className="mr-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Add Employee
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                <h3 className="text-xl font-semibold">Bill Details</h3>
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedBillDetails(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full"
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
                        <h4 className="font-semibold mb-3">Basic Information</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">Bill ID:</span> {details.basicInfo.id}</div>
                          <div><span className="font-medium">Employee ID:</span> {details.basicInfo.employeeId}</div>
                          <div><span className="font-medium">Employee Name:</span> {details.basicInfo.employeeName}</div>
                          <div><span className="font-medium">Submitted:</span> {details.basicInfo.submittedAt}</div>
                        </div>
                      </div>

                      {/* Purchase Details */}
                      <div className="bg-blue-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3">Purchase Details</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">PO Details:</span> {details.purchaseDetails.poDetails}</div>
                          <div><span className="font-medium">Supplier:</span> {details.purchaseDetails.supplierName}</div>
                          <div><span className="font-medium">Category:</span> {details.purchaseDetails.itemCategory}</div>
                          <div><span className="font-medium">Quantity:</span> {details.purchaseDetails.quantity}</div>
                          <div className="col-span-2"><span className="font-medium">Description:</span> {details.purchaseDetails.itemDescription}</div>
                          <div><span className="font-medium">Total Value:</span> ₹{details.purchaseDetails.totalValue.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Workflow Status */}
                      <div className="bg-green-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3">Workflow Status</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><span className="font-medium">Overall Status:</span> {details.workflowStatus.overall}</div>
                          <div><span className="font-medium">Store and Purchase Department Status:</span> {details.workflowStatus.snpStatus}</div>
                          <div><span className="font-medium">Audit Status:</span> {details.workflowStatus.auditStatus}</div>
                          <div><span className="font-medium">Finance Admin:</span> {details.workflowStatus.financeAdminStatus}</div>
                        </div>
                      </div>

                      {/* Department Remarks */}
                      <div className="bg-yellow-50 rounded-lg p-4">
                        <h4 className="font-semibold mb-3">Department Remarks</h4>
                        <div className="space-y-2 text-sm">
                          <div className="bg-white p-2 rounded">
                            <span className="font-medium">Store and Purchase Department:</span> {details.departmentRemarks.snp}
                          </div>
                          <div className="bg-white p-2 rounded">
                            <span className="font-medium">Audit:</span> {details.departmentRemarks.audit}
                          </div>
                          <div className="bg-white p-2 rounded">
                            <span className="font-medium">Finance Admin:</span> {details.departmentRemarks.financeAdmin}
                          </div>
                          {details.departmentRemarks.other !== "No remark" && (
                            <div className="bg-white p-2 rounded">
                              <span className="font-medium">Other:</span> {details.departmentRemarks.other}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {editingEmployee && (
        <EditEmployeeForm
          employee={editingEmployee}
          onSave={handleSaveEmployee}
          onCancel={() => setEditingEmployee(null)}
        />
      )}
    </AppShell>
  );
}

// helper to normalize department before sending to DB
// accept only exact matches from the allowed DEPARTMENTS list
const normalizeDepartment = (raw?: string | null) => {
  if (!raw) return null;
  return DEPARTMENTS.includes(raw) ? raw : null;
};
