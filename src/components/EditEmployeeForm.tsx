"use client";
import React, { useState } from "react";
import Modal, { btn, Field, fieldClass } from "@/components/ui/modal";
import { deskLabel } from "@/lib/roles";

// allowed departments
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

import type { Employee } from "@/types/database";

interface EditEmployeeFormProps {
  employee: Employee;
  onSave: (updatedEmployee: Employee) => void;
  onCancel: () => void;
}

const EditEmployeeForm: React.FC<EditEmployeeFormProps> = ({
  employee,
  onSave,
  onCancel,
}) => {
  const [formData, setFormData] = useState<Employee>({
    ...employee,
    email: employee.email ?? "",
    employee_type: employee.employee_type ?? "",
    department: employee.department ?? "",
    employee_code: employee.employee_code ?? "",
  });
  const [isSaving, setIsSaving] = useState(false);

  // keep form in sync if parent passes a new employee prop
  React.useEffect(() => {
    setFormData({
      ...employee,
      email: employee.email ?? "",
      employee_type: employee.employee_type ?? "",
      department: employee.department ?? "",
      employee_code: employee.employee_code ?? "",
    });
  }, [employee]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(formData);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={`Edit ${formData.employee_name || formData.employee_code}`}
      description="The employee code and role cannot be changed here; only the Dean assigns roles."
      onClose={onCancel}
      footer={<>
        <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
        <button type="submit" form="edit-employee" className={btn.primary} disabled={isSaving} aria-busy={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </>}
    >
      <form id="edit-employee" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name">
          <input name="employee_name" value={formData.employee_name ?? ""} onChange={handleChange} className={fieldClass} autoComplete="name" required />
        </Field>
        <Field label="Email address">
          <input type="email" name="email" value={formData.email ?? ""} onChange={handleChange} className={fieldClass} autoComplete="email" required />
        </Field>
        <Field label="Department">
          <select name="department" value={formData.department ?? ""} onChange={handleChange} className={fieldClass}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee code">
            <input readOnly value={formData.employee_code ?? ""} className={fieldClass} />
          </Field>
          <Field label="Role">
            <input readOnly value={deskLabel(formData.employee_type)} className={fieldClass} />
          </Field>
        </div>
      </form>
    </Modal>
  );
};

export default EditEmployeeForm;
