"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState, type ReactNode } from "react";
import { signOut, useSession } from "next-auth/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { IconArrowsExchange, IconBook, IconBuildingBank, IconFileText, IconHome, IconLogout, IconMenu2, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import BillSearch from "./BillSearch";
import { canOpenMovementRegister, deskLabel, homeFor, normaliseRole } from "@/lib/roles";

export type NavItem = {
  label: string;
  icon: ReactNode;
  /** In-page section switch. */
  onClick?: () => void;
  /** Another page. */
  href?: string;
  active?: boolean;
  /** Small count shown at the end of the row. */
  badge?: number | string | null;
};

/** Only the Dean may open the portal-wide bill list and the purchase register. */
export const canOpenPortalPages = (role: string | null | undefined) => normaliseRole(role) === "Dean";

/** Pages a desk can open besides its own sections. */
export function sharedLinks(role: string | null | undefined, current?: "bills" | "register" | "detail" | "movements" | "OH-31" | "OH-35"): NavItem[] {
  const r = normaliseRole(role);
  const items: NavItem[] = [];
  if (current) items.push({ label: "My desk", icon: <IconHome />, href: homeFor(r) });
  if (canOpenMovementRegister(r)) {
    items.push({ label: "Inward / Outward", icon: <IconArrowsExchange />, href: "/movement-register", active: current === "movements" });
  }
  if (canOpenPortalPages(r)) {
    items.push({ label: "All Bills", icon: <IconFileText />, href: "/bills", active: current === "bills" });
    items.push({ label: "Purchase Register", icon: <IconBook />, href: "/register", active: current === "register" });
    items.push({ label: "OH-31 Register", icon: <IconBuildingBank />, href: "/fund-register/OH-31", active: current === "OH-31" });
    items.push({ label: "OH-35 Register", icon: <IconBuildingBank />, href: "/fund-register/OH-35", active: current === "OH-35" });
  }
  return items;
}

function NavRow({ item, onNavigate, group }: { item: NavItem; onNavigate: () => void; group: string }) {
  const cls = cn(
    "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors duration-150",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
    item.active ? "text-blue-800" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
  );
  const body = (
    <>
      {item.active && (
        <motion.span layoutId={`nav-active-${group}`} className="absolute inset-0 -z-10 rounded-md bg-blue-50"
          transition={{ type: "spring", stiffness: 500, damping: 40 }} />
      )}
      <span className={cn("relative flex size-5 shrink-0 items-center justify-center [&>svg]:size-5 [&>svg]:!text-current", item.active ? "text-blue-700" : "text-slate-500 group-hover:text-slate-700")}>
        {item.icon}
      </span>
      <span className="relative flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && item.badge !== null && item.badge !== "" && (
        <span className={cn("relative rounded-full px-2 py-0.5 text-xs tabular-nums", item.active ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600")}>
          {item.badge}
        </span>
      )}
    </>
  );
  if (item.href) {
    return <Link href={item.href} className={cls} aria-current={item.active ? "page" : undefined} onClick={onNavigate}>{body}</Link>;
  }
  return (
    <button type="button" className={cls} aria-current={item.active ? "page" : undefined}
      onClick={() => { item.onClick?.(); onNavigate(); }}>
      {body}
    </button>
  );
}

/**
 * The one frame every desk uses: a labelled sidebar (a drawer on phones),
 * the signed-in person and sign-out, and a scrolling content area.
 */
export default function AppShell({
  desk,
  nav,
  links,
  children,
  fill = false,
}: {
  /** Shown under the portal name, e.g. "Finance Admin". */
  desk: string;
  /** This desk's own sections. */
  nav: NavItem[];
  /** Other pages; defaults to All Bills and the Purchase Register. */
  links?: NavItem[];
  children: ReactNode;
  /** Content fills the height (e.g. the bill wizard) instead of a padded, scrolling page. */
  fill?: boolean;
}) {
  const { data: session } = useSession();
  const [drawer, setDrawer] = useState(false);
  // Content fades in again whenever the desk switches section.
  const section = nav.find((n) => n.active)?.label ?? "";
  const shared = links ?? sharedLinks(session?.user?.employee_type);

  useEffect(() => {
    if (!drawer) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);

  const name = session?.user?.name ?? session?.user?.username ?? "";
  const role = session?.user?.employee_type ? deskLabel(normaliseRole(session.user.employee_type)) : "";

  const panel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
        <Image src="/iit.png" alt="" width={36} height={36} className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">IIT Mandi Finance</p>
          <p className="truncate text-xs text-slate-500">{deskLabel(desk)}</p>
        </div>
      </div>
      <nav aria-label="Sections" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {nav.length > 0 && (
          <div className="space-y-1">{nav.map((item) => <NavRow key={item.label} item={item} group="desk" onNavigate={() => setDrawer(false)} />)}</div>
        )}
        {shared.length > 0 && (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Portal</p>
            {shared.map((item) => <NavRow key={item.label} item={item} group="portal" onNavigate={() => setDrawer(false)} />)}
          </div>
        )}
      </nav>
      <div className="border-t border-slate-200 p-3">
        {name && (
          <div className="mb-2 px-3">
            <p className="truncate text-sm font-medium text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">{role}</p>
          </div>
        )}
        <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <IconLogout className="size-5 text-slate-500" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900 print:block print:h-auto print:overflow-visible print:bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-blue-700 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white">
        Skip to main content
      </a>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block print:hidden">{panel}</aside>

      <AnimatePresence>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <motion.div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl"
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}>
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)}
              className="absolute right-2 top-3 rounded-md p-2 text-slate-500 hover:bg-slate-100">
              <IconX className="size-5" />
            </button>
            {panel}
          </motion.aside>
        </div>
      )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-center border-b border-slate-200 bg-white pl-14 pr-4 md:px-8 print:hidden">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="absolute left-3 rounded-md p-2 text-slate-700 hover:bg-slate-100 md:hidden">
            <IconMenu2 className="size-5" aria-hidden="true" />
          </button>
          <BillSearch />
        </header>
        <main id="main" tabIndex={-1} className={cn("min-h-0 flex-1 focus:outline-none print:overflow-visible", fill ? "flex flex-col overflow-hidden p-4 md:p-6" : "overflow-y-auto")}>
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={fill ? "flex min-h-0 flex-1 flex-col" : "mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8"}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
    </MotionConfig>
  );
}
