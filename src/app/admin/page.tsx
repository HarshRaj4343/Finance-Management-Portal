"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSession } from "next-auth/react";
import {
  IconUsers,
  IconUserPlus,
  IconBook,
  IconAlertCircle,
} from "@tabler/icons-react";
import { api, money, qs, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import AppShell from "@/components/AppShell";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { PageHeader } from "@/components/ui/page";
import Modal, { btn, Field, fieldClass } from "@/components/ui/modal";
import { ROLES, ASSIGNABLE_ROLES, normaliseRole, deskLabel, type Role } from "@/lib/roles";
import { useConfirm } from "@/components/ConfirmProvider";
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
  User: "bg-slate-100 text-slate-600",
};

const BLANK = {
  employee_code: "",
  employee_name: "",
  email: "",
  department: "",
  employee_type: "User" as Role,
  allocated: "",
};



export default function AdminPage() {
  const { data: session, status } = useSession();
  const confirm = useConfirm();
  const myRole = normaliseRole((session?.user as { employee_type?: string })?.employee_type);

  const [people, setPeople] = useState<EmployeeWithPda[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
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
    if (!(await confirm({
      title: "Change this person's role?",
      description: "Their access changes on their next request.",
      details: [["Employee", `${person.employee_name} (${person.employee_code})`],
        ["From", deskLabel(normaliseRole(person.employee_type))], ["To", deskLabel(role)]],
      confirmLabel: "Change role",
    }))) return;
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
      text: `${data!.employee.employee_name} is now ${deskLabel(role)}. They will see the change the next time they sign in.`,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!(await confirm({
      title: "Save these employee details?",
      details: [["Employee", `${editing.employee_name} (${editing.employee_code})`], ["Email", editing.email], ["Department", editing.department ?? "—"]],
      confirmLabel: "Save changes",
    }))) return;
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
    if (!(await confirm({
      title: "Add this employee?",
      details: [["Name", draft.employee_name], ["Code", draft.employee_code], ["Email", draft.email],
        ["Department", draft.department || "—"], ["Role", deskLabel(draft.employee_type)],
        ["PDA allocation", draft.allocated ? money(Number(draft.allocated)) : "None"]],
      confirmLabel: "Add employee",
    }))) return;
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
    if (!(await confirm({
      title: `Deactivate ${person.employee_name}?`,
      description: "They will not be able to sign in. Their bills, approvals and register entries are kept — those are part of the permanent record.",
      details: [["Employee", `${person.employee_name} (${person.employee_code})`]],
      confirmLabel: "Deactivate",
      tone: "danger",
    }))) return;

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
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ kind: "bad", text: "Enter an amount to add." });
      return;
    }
    if (!(await confirm({
      title: "Add to this PDA allocation?",
      details: [["Employee", `${toppingUp.employee_name} (${toppingUp.employee_code})`], ["Amount", money(amount)]],
      confirmLabel: "Add funds",
    }))) return;
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
    if (!(await confirm({
      title: "Open a PDA account?",
      details: [["Employee", `${person.employee_name} (${person.employee_code})`], ["Starting allocation", money(0)]],
      confirmLabel: "Open account",
    }))) return;
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
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-slate-600">Loading...</span>
      </div>
    );
  }

  if (myRole !== "Dean" && myRole !== "Finance Admin") {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 p-4">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-md">
          <IconAlertCircle className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <h1 className="text-xl font-bold text-slate-800 mb-2">
            This page is for the Dean of Finance
          </h1>
          <p className="text-slate-600 mb-4">You are signed in as {myRole}.</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to the portal
          </Link>
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
    <AppShell
      desk={myRole === "Dean" ? "Dean" : "People and Roles"}
      nav={links.map((link) => ({ label: link.label, icon: link.icon, onClick: link.onClick, active: activeFilter === link.label }))}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title="People and Roles"
        description={myRole === "Dean"
          ? "A role decides which desk somebody lands on and what they may approve."
          : "Only the Dean of Finance can change a role. You can correct names, emails and departments."}
      />

        {unprovisioned.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {unprovisioned.length}{" "}
            {unprovisioned.length === 1 ? "person has" : "people have"} no PDA account
            yet, so no bill can be filed against them.
          </div>
        )}

        <FilterBar
          search={searchQuery}
          onSearch={setSearchQuery}
          placeholder="Search by name, employee code or email"
          onClear={() => { setSearchQuery(""); setRoleFilter(""); setShowInactive(false); }}
          active={Boolean(searchQuery || roleFilter || showInactive)}
          actions={
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
            >
              <IconUserPlus className="size-4" />
              {adding ? "Cancel" : "Add Person"}
            </button>
          }
        >
          <FilterField label="Role">
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={filterInput}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{deskLabel(r)}</option>
              ))}
            </select>
          </FilterField>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-slate-300" />
            Include deactivated people
          </label>
        </FilterBar>

        {/* Add form */}
        <AnimatePresence>
          {adding && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={addPerson}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm overflow-hidden"
            >
              <h2 className="font-semibold text-slate-800 mb-1">Add a person</h2>
              <p className="text-sm text-slate-500 mb-4">
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {label}
                    </label>
                    <input
                      required
                      value={draft[key]}
                      placeholder={hint}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    required
                    value={draft.department}
                    onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Role {myRole !== "Dean" && "(Dean only)"}
                  </label>
                  <select
                    disabled={myRole !== "Dean"}
                    value={draft.employee_type}
                    onChange={(e) =>
                      setDraft({ ...draft, employee_type: e.target.value as Role })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {deskLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Opening PDA allocation
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.allocated}
                    placeholder="0"
                    onChange={(e) => setDraft({ ...draft, allocated: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
            <IconUsers className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-slate-800">{activeFilter}</h2>
            <span className="ml-auto text-sm text-slate-500">{shown.length} people</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-slate-600">Loading people...</span>
            </div>
          ) : shown.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <IconUsers className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p>Nobody matches those filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Employee", "Department", "Role", "PDA", "Actions"].map((h) => (
                      <th scope="col"
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {shown.map((p) => (
                    <tr
                      key={p.employee_code}
                      className={`hover:bg-slate-50 ${p.is_active ? "" : "opacity-50"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">
                          {p.employee_name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {p.employee_code} · {p.email}
                        </span>
                      </td>

                      <td className="px-4 py-3 max-w-[14rem] text-slate-600">
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
                            {[...ASSIGNABLE_ROLES, ...(normaliseRole(p.employee_type) === "Bill Editor" ? ["Bill Editor" as const] : [])].map((r) => (
                              <option key={r} value={r} className="bg-white text-slate-900" disabled={r === "Bill Editor"}>
                                {deskLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              ROLE_TONE[normaliseRole(p.employee_type)]
                            }`}
                          >
                            {deskLabel(normaliseRole(p.employee_type))}
                          </span>
                        )}
                      </td>

                      <td className="min-w-[12rem] px-4 py-3">
                        {p.pda ? (
                          <>
                            <span className="font-medium text-slate-800">
                              {money(p.pda.balance)}
                            </span>
                            <span className="block text-xs text-slate-500">
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
                        {/* Fixed slots, so Deactivate never shifts when there is no PDA to top up. */}
                        <div className="inline-grid grid-cols-[2.5rem_3.5rem_4.5rem] items-center gap-2 text-xs">
                          <button onClick={() => setEditing(p)} className="justify-self-start text-blue-600 hover:underline">
                            Edit
                          </button>
                          {p.pda ? (
                            <button
                              onClick={() => { setToppingUp(p); setTopUpAmount(""); }}
                              className="justify-self-start text-blue-600 hover:underline"
                            >
                              Top up
                            </button>
                          ) : (
                            <span title="No PDA account to top up" className="block w-8 border-t border-dashed border-slate-300" aria-hidden="true" />
                          )}
                          {p.is_active ? (
                            <button
                              onClick={() => deactivate(p)}
                              disabled={busy === p.employee_code}
                              className="justify-self-start text-red-600 hover:underline disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <span className="text-slate-500">Deactivated</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {editing && (
        <Modal
          title={`Edit ${editing.employee_code}`}
          description="The employee code cannot be changed — bills, approvals and register entries all refer to it."
          onClose={() => setEditing(null)}
          footer={<>
            <button onClick={() => setEditing(null)} className={btn.secondary}>Cancel</button>
            <button onClick={saveEdit} disabled={busy === editing.employee_code} className={btn.primary}>Save changes</button>
          </>}
        >
          <Field label="Full name">
            <input value={editing.employee_name} onChange={(e) => setEditing({ ...editing, employee_name: e.target.value })} className={fieldClass} autoComplete="name" />
          </Field>
          <Field label="Email address">
            <input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} className={fieldClass} autoComplete="email" />
          </Field>
          <Field label="Department">
            <select value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} className={fieldClass}>
              {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}

      {toppingUp && (
        <Modal
          title={`Top up ${toppingUp.employee_name}`}
          onClose={() => setToppingUp(null)}
          size="sm"
          footer={<>
            <button onClick={() => setToppingUp(null)} className={btn.secondary}>Cancel</button>
            <button onClick={topUp} disabled={busy === toppingUp.employee_code} className={btn.primary}>Add funds</button>
          </>}
        >
          {toppingUp.pda && (
            <dl className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              {([
                ["Allocated", toppingUp.pda.allocated],
                ["Free to commit", toppingUp.pda.balance],
                ["Committed to bills in progress", toppingUp.pda.committed],
                ["Spent", toppingUp.pda.spent],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{money(value)}</dd>
                </div>
              ))}
              <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">Last changed {when(toppingUp.pda.updated_at)}</p>
            </dl>
          )}
          <Field label="Amount to add (₹)" hint="A positive amount. To reduce an allocation, set it on the PDA Accounts page; it cannot go below what is committed or spent.">
            <input type="number" min={0} step="0.01" autoFocus value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className={fieldClass} />
          </Field>
        </Modal>
      )}
    </AppShell>
  );
}
