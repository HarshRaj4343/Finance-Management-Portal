"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signOut, useSession } from "next-auth/react";
import {
  IconArrowLeft,
  IconHome,
  IconUsers,
  IconUserPlus,
  IconSearch,
  IconFilter,
  IconBook,
  IconWallet,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Sidebar, SidebarBody } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { api, money, qs, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { ROLES, normaliseRole, type Role } from "@/lib/roles";
import type { Employee, PdaBalanceRow, DepartmentRow } from "@/types/database";

/**
 * The Dean of Finance's desk.
 *
 * architecture.jpeg: "Check Employee Type" / "No Employee Type Matched".
 * LDAP proves who somebody is; this page decides what they may do. It is
 * the only place a role is assigned, and the API enforces that too -- a
 * Finance Admin can correct a name here, but the role dropdown is refused
 * for anybody but the Dean.
 */

type EmployeeWithPda = Employee & { pda: PdaBalanceRow | null };

const ROLE_TONE: Record<Role, string> = {
  Dean: "bg-blue-100 text-blue-800",
  "Finance Admin": "bg-sky-100 text-sky-800",
  Audit: "bg-yellow-100 text-yellow-800",
  "Student Purchase": "bg-purple-100 text-purple-800",
  "PDA Manager": "bg-green-100 text-green-800",
  "Bill Employee": "bg-indigo-100 text-indigo-800",
  "Bill Editor": "bg-teal-100 text-teal-800",
  User: "bg-gray-100 text-gray-600",
};

const BLANK = {
  employee_code: "",
  employee_name: "",
  email: "",
  department: "",
  employee_type: "User" as Role,
  allocated: "",
};

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
      People and Roles
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

export default function AdminPage() {
  const { data: session, status } = useSession();
  const myRole = normaliseRole((session?.user as { employee_type?: string })?.employee_type);

  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<EmployeeWithPda[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilter, setActiveFilter] = useState("Everyone");

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ...BLANK });
  const [editing, setEditing] = useState<EmployeeWithPda | null>(null);
  const [toppingUp, setToppingUp] = useState<EmployeeWithPda | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
  }, [status]);

  useEffect(() => {
    api
      .get<{ departments: DepartmentRow[] }>("/api/departments")
      .then(({ data }) => data && setDepartments(data.departments));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get<{ employees: EmployeeWithPda[] }>(
      "/api/admin/employees" +
        qs({ q: searchQuery, role: roleFilter, active: showInactive ? "" : "true" })
    );
    setLoading(false);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setPeople(data!.employees);
  }, [searchQuery, roleFilter, showInactive]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [status, load]);

  /* -------------------------------------------------------- actions */

  const changeRole = async (person: EmployeeWithPda, role: Role) => {
    setBusy(person.employee_code);
    const { data, error } = await api.patch<{ employee: Employee }>(
      `/api/admin/employees/${encodeURIComponent(person.employee_code)}`,
      { employee_type: role }
    );
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setPeople((prev) =>
      prev.map((p) =>
        p.employee_code === person.employee_code ? { ...p, employee_type: role } : p
      )
    );
    setNotice({
      kind: "ok",
      text: `${data!.employee.employee_name} is now ${role}. They will see the change the next time they sign in.`,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(editing.employee_code);
    const { data, error } = await api.patch<{ employee: Employee }>(
      `/api/admin/employees/${encodeURIComponent(editing.employee_code)}`,
      {
        employee_name: editing.employee_name,
        email: editing.email,
        department: editing.department,
      }
    );
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setPeople((prev) =>
      prev.map((p) =>
        p.employee_code === data!.employee.employee_code ? { ...p, ...data!.employee } : p
      )
    );
    setEditing(null);
    setNotice({ kind: "ok", text: `${data!.employee.employee_name} updated.` });
  };

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("new");
    const { data, error } = await api.post<{ employee: Employee; note: string | null }>(
      "/api/admin/employees",
      { ...draft, allocated: draft.allocated ? Number(draft.allocated) : 0 }
    );
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setAdding(false);
    setDraft({ ...BLANK });
    await load();
    setNotice({
      kind: data!.note ? "info" : "ok",
      text: data!.note ?? `${data!.employee.employee_name} added.`,
    });
  };

  const deactivate = async (person: EmployeeWithPda) => {
    if (
      !confirm(
        `Deactivate ${person.employee_name}?\n\n` +
          "They will not be able to sign in. Their bills, approvals and register " +
          "entries are kept — those are part of the permanent record."
      )
    )
      return;

    setBusy(person.employee_code);
    const { data, error } = await api.del<{ note: string }>(
      `/api/admin/employees/${encodeURIComponent(person.employee_code)}`
    );
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    await load();
    setNotice({ kind: "ok", text: data!.note });
  };

  const topUp = async () => {
    if (!toppingUp) return;
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setNotice({ kind: "bad", text: "Enter an amount to add." });
      return;
    }
    setBusy(toppingUp.employee_code);
    const { data, error } = await api.patch<{ account: PdaBalanceRow }>("/api/admin/pda", {
      employee_id: toppingUp.employee_code,
      top_up: amount,
    });
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setPeople((prev) =>
      prev.map((p) =>
        p.employee_code === toppingUp.employee_code ? { ...p, pda: data!.account } : p
      )
    );
    setToppingUp(null);
    setTopUpAmount("");
    setNotice({
      kind: "ok",
      text: `${money(amount)} added. ${money(data!.account.balance)} is now free to commit.`,
    });
  };

  const openPda = async (person: EmployeeWithPda) => {
    setBusy(person.employee_code);
    const { error } = await api.post("/api/admin/pda", {
      employee_id: person.employee_code,
      allocated: 0,
    });
    setBusy(null);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    await load();
    setNotice({
      kind: "ok",
      text: `PDA account opened for ${person.employee_name}. Add an allocation to let them file bills.`,
    });
  };

  /* --------------------------------------------------------- render */

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (myRole !== "Dean" && myRole !== "Finance Admin") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 p-4">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-md">
          <IconAlertCircle className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">
            This page is for the Dean of Finance
          </h1>
          <p className="text-gray-600 mb-4">You are signed in as {myRole}.</p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to the portal
          </a>
        </div>
      </div>
    );
  }

  const unprovisioned = people.filter((p) => p.employee_type === "User" && !p.pda);

  const links = [
    {
      label: "Everyone",
      icon: <IconUsers className="h-5 w-5 shrink-0 text-blue-600" />,
      onClick: () => {
        setActiveFilter("Everyone");
        setRoleFilter("");
        setShowInactive(false);
      },
    },
    {
      label: "Approvers",
      icon: <IconBook className="h-5 w-5 shrink-0 text-green-600" />,
      onClick: () => {
        setActiveFilter("Approvers");
        setRoleFilter("");
        setShowInactive(false);
        setSearchQuery("");
      },
    },
    {
      label: "Deactivated",
      icon: <IconAlertCircle className="h-5 w-5 shrink-0 text-red-600" />,
      onClick: () => {
        setActiveFilter("Deactivated");
        setShowInactive(true);
      },
    },
  ];

  const shown =
    activeFilter === "Approvers"
      ? people.filter((p) =>
          ["Student Purchase", "Audit", "Finance Admin"].includes(
            normaliseRole(p.employee_type)
          )
        )
      : activeFilter === "Deactivated"
      ? people.filter((p) => !p.is_active)
      : people;

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
                    activeFilter === link.label
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
              onClick={() => (window.location.href = "/register")}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
            >
              <IconBook className="h-5 w-5 shrink-0 text-neutral-700" />
              {open && <span>Register</span>}
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
            >
              <IconHome className="h-5 w-5 shrink-0 text-neutral-700" />
              {open && <span>Portal</span>}
            </button>
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
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
            People and Roles
          </h1>
          <p className="text-gray-600 font-medium">
            {myRole === "Dean"
              ? "A role decides which desk somebody lands on and what they may approve"
              : "Only the Dean of Finance can change a role. You can correct names, emails and departments."}
          </p>
        </motion.div>

        {unprovisioned.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-900">
            {unprovisioned.length}{" "}
            {unprovisioned.length === 1 ? "person has" : "people have"} no PDA account
            yet, so no bill can be filed against them.
          </div>
        )}

        {/* Search and Filter Section */}
        <div className="bg-white rounded-lg shadow p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, employee code, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                showFilters
                  ? "bg-blue-100 text-blue-700 border-blue-300"
                  : "bg-gray-100 text-gray-700 border-gray-300"
              }`}
            >
              <IconFilter className="h-5 w-5" />
              Filters
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <IconUserPlus className="h-5 w-5" />
              {adding ? "Cancel" : "Add Person"}
            </button>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role
                  </label>
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All roles</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Include deactivated people
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Add form */}
        <AnimatePresence>
          {adding && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={addPerson}
              className="bg-white rounded-lg shadow p-4 overflow-hidden"
            >
              <h2 className="font-semibold text-gray-800 mb-1">Add a person</h2>
              <p className="text-sm text-gray-500 mb-4">
                Add somebody before their first sign-in, so they land on the right desk
                straight away instead of the plain user page.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(
                  [
                    ["employee_code", "Employee code", "e.g. B24101 or ADM012"],
                    ["employee_name", "Full name", ""],
                    ["email", "Email address", ""],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {label}
                    </label>
                    <input
                      required
                      value={draft[key]}
                      placeholder={hint}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Department
                  </label>
                  <select
                    required
                    value={draft.department}
                    onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Choose...</option>
                    {departments.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role {myRole !== "Dean" && "(Dean only)"}
                  </label>
                  <select
                    disabled={myRole !== "Dean"}
                    value={draft.employee_type}
                    onChange={(e) =>
                      setDraft({ ...draft, employee_type: e.target.value as Role })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Opening PDA allocation
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.allocated}
                    placeholder="0"
                    onChange={(e) => setDraft({ ...draft, allocated: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy === "new"}
                className="mt-4 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === "new" ? "Adding..." : "Add"}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* The directory */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <IconUsers className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-gray-800">{activeFilter}</h2>
            <span className="ml-auto text-sm text-gray-500">{shown.length} people</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading people...</span>
            </div>
          ) : shown.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <IconUsers className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p>Nobody matches those filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["Employee", "Department", "Role", "PDA", "Actions"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {shown.map((p) => (
                    <tr
                      key={p.employee_code}
                      className={`hover:bg-gray-50 ${p.is_active ? "" : "opacity-50"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">
                          {p.employee_name}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {p.employee_code} · {p.email}
                        </span>
                      </td>

                      <td className="px-4 py-3 max-w-[14rem] text-gray-600">
                        <span className="block truncate" title={p.department}>
                          {p.department}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {myRole === "Dean" ? (
                          <select
                            value={normaliseRole(p.employee_type)}
                            disabled={busy === p.employee_code || !p.is_active}
                            onChange={(e) => changeRole(p, e.target.value as Role)}
                            className={`px-2 py-1 rounded text-xs font-medium border-0 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                              ROLE_TONE[normaliseRole(p.employee_type)]
                            }`}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r} className="bg-white text-gray-900">
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              ROLE_TONE[normaliseRole(p.employee_type)]
                            }`}
                          >
                            {normaliseRole(p.employee_type)}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.pda ? (
                          <>
                            <span className="font-medium text-gray-800">
                              {money(p.pda.balance)}
                            </span>
                            <span className="block text-xs text-gray-400">
                              free of {money(p.pda.allocated)}
                              {Number(p.pda.committed) > 0 &&
                                ` · ${money(p.pda.committed)} committed`}
                            </span>
                          </>
                        ) : (
                          <button
                            onClick={() => openPda(p)}
                            disabled={busy === p.employee_code}
                            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                          >
                            Open an account
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => setEditing(p)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        {p.pda && (
                          <button
                            onClick={() => {
                              setToppingUp(p);
                              setTopUpAmount("");
                            }}
                            className="ml-3 text-xs text-blue-600 hover:underline"
                          >
                            Top up
                          </button>
                        )}
                        {p.is_active ? (
                          <button
                            onClick={() => deactivate(p)}
                            disabled={busy === p.employee_code}
                            className="ml-3 text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <span className="ml-3 text-xs text-gray-400">Deactivated</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg shadow-xl w-full max-w-lg"
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                Edit {editing.employee_code}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                The employee code cannot be changed — bills, approvals and register
                entries all refer to it.
              </p>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full name
                </label>
                <input
                  value={editing.employee_name}
                  onChange={(e) =>
                    setEditing({ ...editing, employee_name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <input
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <select
                  value={editing.department}
                  onChange={(e) => setEditing({ ...editing, department: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {departments.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={busy === editing.employee_code}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Top-up dialog */}
      {toppingUp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg shadow-xl w-full max-w-md"
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
              <IconWallet className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-800">
                Top up {toppingUp.employee_name}
              </h2>
            </div>

            <div className="px-6 py-4">
              {toppingUp.pda && (
                <dl className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1 mb-4">
                  {[
                    ["Allocated", toppingUp.pda.allocated],
                    ["Free to commit", toppingUp.pda.balance],
                    ["Committed to bills in progress", toppingUp.pda.committed],
                    ["Spent", toppingUp.pda.spent],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="font-medium text-gray-800">
                        {money(value as number)}
                      </dd>
                    </div>
                  ))}
                  <p className="border-t pt-2 mt-2 text-xs text-gray-400">
                    Last changed {when(toppingUp.pda.updated_at)}
                  </p>
                </dl>
              )}

              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount to add to the allocation
              </label>
              <input
                type="number"
                autoFocus
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                A negative number reduces it. It cannot go below what is already
                committed or spent.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setToppingUp(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={topUp}
                disabled={busy === toppingUp.employee_code}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
