"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { signOut, useSession } from "next-auth/react";
import { Sidebar, SidebarBody } from "@/components/ui/sidebar";
import { IconArrowLeft } from "@tabler/icons-react";
import { Logo, LogoIcon } from "./Logo";
import SidebarLinks from "./SidebarLinks";
import UploadBill from "./UploadBill";
import BillsHistory from "./BillsHistory";
import ApprovedBills from "./ApprovedBills";
import { Bill } from "./types";

type PageView = "upload" | "history" | "approved";

export default function EmployeeDashboard() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<PageView>("upload");
  const [department, setDepartment] = useState<string | null>(null);

  const [notice, setNotice] = useState<NoticeState>(null);

  /**
   * This desk files bills on behalf of a school. It shows the ones that
   * came back rejected and have not been acknowledged yet, so somebody can
   * see what needs re-filing.
   *
   * The department comes from /api/me rather than from a lookup with four
   * `like` patterns: employee codes are trimmed by a CHECK constraint now,
   * so there is nothing left to guess at.
   */
  const loadBills = async (dept: string) => {
    const { data, error } = await api.get<{ bills: Bill[] }>(
      `/api/bills?department=${encodeURIComponent(dept)}&limit=500`
    );
    if (error) {
      setNotice({ kind: "bad", text: error });
      setBills([]);
      return;
    }
    setBills(
      data!.bills.filter(
        (b) =>
          (b.status === "Rejected" ||
            b.snp === "Reject" ||
            b.audit === "Reject" ||
            b.finance_admin === "Reject") &&
          !b.noted
      )
    );
  };

  useEffect(() => {
    if (!session?.user?.id) return;

    const run = async () => {
      setLoading(true);
      const me = await api.get<{ department: string | null }>("/api/me");
      if (me.error) {
        setNotice({ kind: "bad", text: me.error });
        setLoading(false);
        return;
      }

      const dept = me.data!.department;
      setDepartment(dept);

      if (!dept) {
        setBills([]);
        setNotice({
          kind: "info",
          text: "Your account has no department set. Ask the Dean of Finance's office to assign one.",
        });
        setLoading(false);
        return;
      }

      await loadBills(dept);
      setLoading(false);
    };

    run();
  }, [session, activePage]);

  const refreshBills = async () => {
    if (department) await loadBills(department);
  };

  const handleBillSubmitted = () => {
    setActivePage("history");
    refreshBills();
  };

  const handleBillUpdated = () => refreshBills();

  const handleBillNoted = (billId: string) => {
    setBills((prev) => prev.filter((bill) => bill.id !== billId));
  };

  return (
    <div className="flex h-screen w-full bg-white overflow-hidden">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {/* Sidebar */}
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-8">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {/* === Sidebar Links === */}
              <button
                onClick={() => setActivePage("upload")}
                className={`flex items-center gap-2 px-3 py-2 rounded ${
                  activePage === "upload" ? "bg-gray-200 font-semibold" : "hover:bg-gray-100"
                }`}
              >
                {open && "Apply Bill"}
              </button>

              <button
                onClick={() => setActivePage("history")}
                className={`flex items-center gap-2 px-3 py-2 rounded ${
                  activePage === "history" ? "bg-gray-200 font-semibold" : "hover:bg-gray-100"
                }`}
              >
                {open && "Rejected Bills"}
              </button>

              {/* Approved Bills sidebar option */}
              <button
                onClick={() => setActivePage("approved")}
                className={`flex items-center gap-2 px-3 py-2 rounded ${
                  activePage === "approved" ? "bg-gray-200 font-semibold" : "hover:bg-gray-100"
                }`}
              >
                {open && "Approved Bills"}
              </button>

              {/* Logout */}
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full mt-4"
              >
                <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700" />
                {open && <span>Logout</span>}
              </button>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      {/* Main Content */}
      <div className="flex flex-1 p-6 overflow-y-auto bg-gray-50">
        {activePage === "upload" && (
          <UploadBill onBillSubmitted={handleBillSubmitted} department={department} />
        )}

        {activePage === "history" && (
          <BillsHistory
            bills={bills}
            loading={loading}
            onBillUpdated={handleBillUpdated}
            allowDelete
            enableEdit={false}
            onBillNoted={handleBillNoted}
          />
        )}

        {/* Approved Bills page rendering */}
        {activePage === "approved" && <ApprovedBills department={department} />}
      </div>
    </div>
  );
}
