"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import BillsHistory from "../apply-bill/BillsHistory";
import { Sidebar, SidebarBody } from "@/components/ui/sidebar";
import { Logo, LogoIcon } from "../apply-bill/Logo";
import { signOut, useSession } from "next-auth/react";
import { Bill } from "../apply-bill/types";

export default function BillEditorPage() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState<string | null>(null);

  const [notice, setNotice] = useState<NoticeState>(null);

  // This desk corrects bills for its own department. The department comes
  // from /api/me; the bills come back already scoped by the server.
  const loadBills = async (dept: string) => {
    const { data, error } = await api.get<{ bills: Bill[] }>(
      `/api/bills?department=${encodeURIComponent(dept)}&limit=500`
    );
    if (error) {
      setNotice({ kind: "bad", text: error });
      setBills([]);
      return;
    }
    setBills(data!.bills);
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
      } else {
        await loadBills(dept);
      }
      setLoading(false);
    };

    run();
  }, [session]);

  const handleBillUpdated = () => {
    if (department) loadBills(department);
  };

  // Below: bills are fetched and set with setBills(data || [])
  // Add a filter for 'Hold' status before rendering
  const billsOnHold = bills.filter(
    b => b.snp === 'Hold' || b.audit === 'Hold' || b.finance_admin === 'Hold'
  );

  return (
    <div className="flex h-screen w-full bg-white overflow-hidden">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-8">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full mt-4"
              >
                <span className="h-5 w-5 shrink-0 text-neutral-700">←</span>
                {open && <span>Logout</span>}
              </button>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      <div className="flex flex-1 p-6 overflow-y-auto bg-gray-50">
        <div className="w-full">
          <h2 className="text-2xl font-semibold mb-6">Bill Editor</h2>
          <BillsHistory bills={billsOnHold} loading={loading} onBillUpdated={handleBillUpdated} alwaysEditable allowDelete={false} />
        </div>
      </div>
    </div>
  );
}


