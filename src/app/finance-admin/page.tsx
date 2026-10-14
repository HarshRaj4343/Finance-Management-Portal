"use client";
import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole, deskLabel } from "@/lib/roles";
import {
  IconUsers,
  IconEdit,
  IconTrash,
  IconPlus,
} from "@tabler/icons-react";
import DeskQueue from "@/components/DeskQueue";
import { PageHeader, Panel } from "@/components/ui/page";
import EditEmployeeForm from "@/components/EditEmployeeForm";
import Modal, { btn, Field, fieldClass } from "@/components/ui/modal";
import { useConfirm } from "@/components/ConfirmProvider";

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

import type { Employee } from "@/types/database";


export default function FinanceAdminDashboard() {
  const { data: session,status} = useSession();
  const confirm = useConfirm();

  const [employees, setEmployees] = useState<Employee[]>([]);

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);


  // Add employee form
  const [showAddEmployeeForm, setShowAddEmployeeForm] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    employee_name: "",
    email: "",
    employee_type: "User",
    department: "Finance and Accounts",
    employee_code: "",
  });

  const [notice, setNotice] = useState<NoticeState>(null);

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
    if (status === "authenticated" && normaliseRole(session?.user?.employee_type) === "Finance Admin") fetchEmployees();
  }, [status, session]);

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

  const th = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
  const employeesView = (
    <>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
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
                  <th scope="col" className={th}>Employee</th>
                  <th scope="col" className={th}>Email</th>
                  <th scope="col" className={th}>Role</th>
                  <th scope="col" className={th}>Department</th>
                  <th scope="col" className={th}><span className="sr-only">Actions</span></th>
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
      {showAddEmployeeForm && (
        <Modal
          title="Add a new employee"
          description="New people start as plain users. Only the Dean assigns workflow roles."
          onClose={() => setShowAddEmployeeForm(false)}
          footer={<>
            <button type="button" onClick={() => setShowAddEmployeeForm(false)} className={btn.secondary}>Cancel</button>
            <button type="submit" form="add-employee" className={btn.primary}>Add employee</button>
          </>}
        >
          <form id="add-employee" onSubmit={handleAddEmployee} className="space-y-4">
            <Field label="Full name">
              <input name="employee_name" value={newEmployee.employee_name} onChange={handleNewEmployeeChange} className={fieldClass} autoComplete="name" required />
            </Field>
            <Field label="Email address">
              <input type="email" name="email" value={newEmployee.email} onChange={handleNewEmployeeChange} className={fieldClass} autoComplete="email" required />
            </Field>
            <Field label="Employee code" hint="Their LDAP ID, e.g. ADM012 or B24101.">
              <input name="employee_code" value={newEmployee.employee_code} onChange={handleNewEmployeeChange} className={fieldClass} required />
            </Field>
            <Field label="Department">
              <select name="department" value={newEmployee.department} onChange={handleNewEmployeeChange} className={fieldClass}>
                {DEPARTMENTS.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
              </select>
            </Field>
          </form>
        </Modal>
      )}

      {editingEmployee && (
        <EditEmployeeForm
          employee={editingEmployee}
          onSave={handleSaveEmployee}
          onCancel={() => setEditingEmployee(null)}
        />
      )}
    </>
  );

  return (
    <DeskQueue
      desk="Finance Admin"
      title="Finance Admin"
      description="Final approval desk. Approving here debits the bill's fund and enters the purchase in the register."
      hints={{
        Pending: "Waiting for you",
        Approved: "Ready for payment",
        Hold: "Waiting for correction",
        Reject: "Funds released",
        All: "Every bill seen by Finance Admin",
      }}
      extraNav={[{ key: "employees", label: "Manage Employees", icon: <IconUsers /> }]}
      extraView={() => employeesView}
    />
  );
}


// helper to normalize department before sending to DB
// accept only exact matches from the allowed DEPARTMENTS list
const normalizeDepartment = (raw?: string | null) => {
  if (!raw) return null;
  return DEPARTMENTS.includes(raw) ? raw : null;
};
