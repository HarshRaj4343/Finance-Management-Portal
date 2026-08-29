"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { api, money, qs, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { ROLES, normaliseRole, type Role } from "@/lib/roles";
import type { Employee, PdaBalanceRow, DepartmentRow } from "@/types/database";

/**
 * The Dean of Finance's desk.
 *
 * architecture.jpeg: "Check Employee Type" and "No Employee Type Matched".
 * LDAP proves who somebody is; this page decides what they may do. It is
 * the only place in the portal where a role is assigned, and the API
 * enforces that too -- a Finance Admin can correct a name here, but the
 * role dropdown is refused for anybody but the Dean.
 */

type EmployeeWithPda = Employee & { pda: PdaBalanceRow | null };

const ROLE_TONE: Record<Role, string> = {
  Dean: "bg-[#217093] text-white",
  "Finance Admin": "bg-sky-100 text-sky-800",
  Audit: "bg-amber-100 text-amber-800",
  "Student Purchase": "bg-violet-100 text-violet-800",
  "PDA Manager": "bg-emerald-100 text-emerald-800",
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

export default function AdminPage() {
  const { data: session, status } = useSession();
  const myRole = normaliseRole((session?.user as { employee_type?: string })?.employee_type);

  const [people, setPeople] = useState<EmployeeWithPda[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ...BLANK });
  const [editing, setEditing] = useState<EmployeeWithPda | null>(null);
  const [toppingUp, setToppingUp] = useState<EmployeeWithPda | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");

  useEffect(() => {
    api
      .get<{ departments: DepartmentRow[] }>("/api/departments")
      .then(({ data }) => data && setDepartments(data.departments));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get<{ employees: EmployeeWithPda[] }>(
      "/api/admin/employees" +
        qs({ q: search, role: roleFilter, active: showInactive ? "" : "true" })
    );
    setLoading(false);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setPeople(data!.employees);
  }, [search, roleFilter, showInactive]);

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
    return <div className="mt-20 text-center text-gray-500">Loading…</div>;
  }
  if (status === "unauthenticated") {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }
  if (myRole !== "Dean" && myRole !== "Finance Admin") {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-lg border bg-white px-6 py-5 text-center shadow-sm">
        <p className="text-gray-700">
          This page is for the Dean of Finance. You are signed in as {myRole}.
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-[#217093] hover:underline">
          Back to the portal
        </Link>
      </div>
    );
  }

  const unprovisioned = people.filter((p) => p.employee_type === "User" && !p.pda);

  return (
    <div className="min-h-screen bg-neutral-50">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <header className="bg-[#217093] px-6 py-5 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] opacity-80">
              IIT Mandi · Integrated Finance Management Portal
            </p>
            <h1 className="mt-1 text-2xl font-semibold">People and Roles</h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/register"
              className="rounded border border-white/40 px-4 py-2 text-sm hover:bg-white/10"
            >
              Purchase register
            </Link>
            <Link
              href="/"
              className="rounded border border-white/40 px-4 py-2 text-sm hover:bg-white/10"
            >
              Back to portal
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <p className="mb-5 max-w-3xl text-sm leading-relaxed text-gray-600">
          A person&apos;s role decides which desk they land on after signing in and
          what they may approve.{" "}
          {myRole === "Dean" ? (
            <>Changing it here takes effect the next time they sign in.</>
          ) : (
            <>
              Only the Dean of Finance can change a role. You can correct names,
              email addresses and departments.
            </>
          )}
        </p>

        {unprovisioned.length > 0 && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {unprovisioned.length} {unprovisioned.length === 1 ? "person has" : "people have"}{" "}
            no PDA account yet, so no bill can be filed against them.
          </div>
        )}

        {/* -------------------------------------------------- controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, employee code, email…"
            className="min-w-[16rem] flex-1 rounded-lg border px-3 py-2 text-sm focus:border-[#217093] focus:outline-none"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm focus:border-[#217093] focus:outline-none"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show deactivated
          </label>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-[#217093] px-4 py-2 text-sm text-white hover:bg-[#1c5a76]"
          >
            {adding ? "Cancel" : "Add a person"}
          </button>
        </div>

        {/* -------------------------------------------------- add form */}
        {adding && (
          <form
            onSubmit={addPerson}
            className="mb-5 grid gap-3 rounded-lg border bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3"
          >
            <p className="col-span-full text-sm text-gray-500">
              Add somebody before their first sign-in, so they land on the right
              desk straight away instead of the plain user page.
            </p>

            {(
              [
                ["employee_code", "Employee code", "e.g. B24101 or ADM012"],
                ["employee_name", "Full name", ""],
                ["email", "Email address", ""],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="text-sm">
                <span className="mb-1 block text-gray-600">{label}</span>
                <input
                  required
                  value={draft[key]}
                  placeholder={hint}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
                />
              </label>
            ))}

            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Department</span>
              <select
                required
                value={draft.department}
                onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
              >
                <option value="">Choose…</option>
                {departments.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-gray-600">
                Role {myRole !== "Dean" && "(Dean only)"}
              </span>
              <select
                disabled={myRole !== "Dean"}
                value={draft.employee_type}
                onChange={(e) =>
                  setDraft({ ...draft, employee_type: e.target.value as Role })
                }
                className="w-full rounded border px-3 py-2 disabled:bg-gray-50 disabled:text-gray-400 focus:border-[#217093] focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Opening PDA allocation</span>
              <input
                type="number"
                min={0}
                value={draft.allocated}
                placeholder="0"
                onChange={(e) => setDraft({ ...draft, allocated: e.target.value })}
                className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
              />
            </label>

            <div className="col-span-full">
              <button
                type="submit"
                disabled={busy === "new"}
                className="rounded-lg bg-[#217093] px-5 py-2 text-sm text-white hover:bg-[#1c5a76] disabled:opacity-50"
              >
                {busy === "new" ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        )}

        {/* ----------------------------------------------------- table */}
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {["Employee", "Department", "Role", "PDA", "", ""].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && people.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    Nobody matches those filters.
                  </td>
                </tr>
              )}

              {!loading &&
                people.map((p) => (
                  <tr
                    key={p.employee_code}
                    className={`hover:bg-gray-50 ${p.is_active ? "" : "opacity-50"}`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{p.employee_name}</span>
                      <span className="block text-xs text-gray-400">
                        {p.employee_code} · {p.email}
                      </span>
                    </td>

                    <td className="max-w-[16rem] px-4 py-3 text-gray-600">
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
                          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
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
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            ROLE_TONE[normaliseRole(p.employee_type)]
                          }`}
                        >
                          {normaliseRole(p.employee_type)}
                        </span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      {p.pda ? (
                        <>
                          <span className="font-medium">{money(p.pda.balance)}</span>
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
                          className="text-xs text-[#217093] hover:underline disabled:opacity-50"
                        >
                          Open an account
                        </button>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="text-xs text-[#217093] hover:underline"
                      >
                        Edit
                      </button>
                      {p.pda && (
                        <button
                          onClick={() => {
                            setToppingUp(p);
                            setTopUpAmount("");
                          }}
                          className="ml-3 text-xs text-[#217093] hover:underline"
                        >
                          Top up
                        </button>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {p.is_active ? (
                        <button
                          onClick={() => deactivate(p)}
                          disabled={busy === p.employee_code}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Deactivated</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* ------------------------------------------------- edit dialog */}
      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Edit {editing.employee_code}</h2>
            <p className="mt-1 text-sm text-gray-500">
              The employee code cannot be changed — bills, approvals and register
              entries all refer to it.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Full name</span>
                <input
                  value={editing.employee_name}
                  onChange={(e) =>
                    setEditing({ ...editing, employee_name: e.target.value })
                  }
                  className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Email address</span>
                <input
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Department</span>
                <select
                  value={editing.department}
                  onChange={(e) => setEditing({ ...editing, department: e.target.value })}
                  className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
                >
                  {departments.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setEditing(null)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={busy === editing.employee_code}
                className="rounded bg-[#217093] px-5 py-2 text-sm text-white hover:bg-[#1c5a76] disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ top-up dialog */}
      {toppingUp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">
              Top up {toppingUp.employee_name}&apos;s PDA
            </h2>

            {toppingUp.pda && (
              <dl className="mt-4 space-y-1 rounded border bg-gray-50 p-3 text-sm">
                {[
                  ["Allocated", toppingUp.pda.allocated],
                  ["Free to commit", toppingUp.pda.balance],
                  ["Committed to bills in progress", toppingUp.pda.committed],
                  ["Spent", toppingUp.pda.spent],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-medium">{money(value as number)}</dd>
                  </div>
                ))}
                <p className="border-t pt-2 text-xs text-gray-400">
                  Last changed {when(toppingUp.pda.updated_at)}
                </p>
              </dl>
            )}

            <label className="mt-4 block text-sm">
              <span className="mb-1 block text-gray-600">
                Amount to add to the allocation
              </span>
              <input
                type="number"
                autoFocus
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="w-full rounded border px-3 py-2 focus:border-[#217093] focus:outline-none"
              />
              <span className="mt-1 block text-xs text-gray-400">
                A negative number reduces it. It cannot go below what is already
                committed or spent.
              </span>
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setToppingUp(null)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={topUp}
                disabled={busy === toppingUp.employee_code}
                className="rounded bg-[#217093] px-5 py-2 text-sm text-white hover:bg-[#1c5a76] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
