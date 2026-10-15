"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Decision } from "./confirmBillDecision";

export type ShortcutList = [keys: string[], what: string][];

/** Every desk shortcut, for the help list (?) and the hint line. */
export const DESK_SHORTCUTS: ShortcutList = [
  [["J", "↓"], "Next bill"],
  [["K", "↑"], "Previous bill"],
  [["A"], "Approve the selected bill, then Ctrl/⌘ + Enter to confirm. With bills ticked: approve all ticked"],
  [["X", "Space"], "Tick / untick the selected bill for bulk approval"],
  [["⇧ J", "⇧ K"], "Tick while moving down / up"],
  [["⇧ A"], "Tick every bill shown (up to the batch limits)"],
  [["U"], "Undo a bulk approval in its countdown"],
  [["H"], "Hold: type the remark, then Ctrl/⌘ + Enter twice (send, confirm)"],
  [["R"], "Reject: type the remark, then Ctrl/⌘ + Enter twice (send, confirm)"],
  [["Esc"], "Leave the remark box, cancel a confirmation, or clear the ticks"],
  [["O", "Enter"], "Open the full bill details in a new tab"],
  [["/"], "Search"],
  [["[", "]"], "Previous / next section (Pending, Approved, Hold, Rejected, All)"],
  [["?"], "Show this list"],
];

export const Kbd = ({ children }: { children: string }) => (
  <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-slate-300 bg-slate-50 px-1.5 font-mono text-xs font-medium text-slate-700 shadow-[0_1px_0_rgb(203_213_225)]">
    {children}
  </kbd>
);

export function ShortcutHelp({ open, onClose, list = DESK_SHORTCUTS, intro = "Work through the queue without the mouse. Shortcuts pause while you type in a box." }: {
  open: boolean; onClose: () => void; list?: ShortcutList; intro?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
        <dl className="divide-y divide-slate-100 text-sm">
          {list.map(([keys, what]) => (
            <div key={what} className="flex items-center gap-4 py-2">
              <dt className="flex w-28 shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dt>
              <dd className="text-slate-700">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export type Armed = { id: string; action: Exclude<Decision, "Approved"> } | null;

const card = (id: string) => document.querySelector<HTMLElement>(`[data-bill-card="${id}"]`);
const dialogOpen = () => Boolean(document.querySelector('[role="alertdialog"], [role="dialog"]'));

/**
 * Keyboard control of a desk queue (DeskQueue). Cards carry
 * data-bill-card; their decision panels carry data-decision buttons and a
 * data-remark box, so the keys press the very same buttons a mouse would,
 * through the same confirmation and server checks.
 *
 * The selected bill is followed by id. When it leaves the list (decided),
 * the bill now in its place is selected, so the next one is ready.
 */
/** Bulk approval controls the keys drive (DeskQueue owns the ticks). */
export type BulkKeys = {
  count: number;
  toggle: (id: string) => void;
  add: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  approve: () => void;
  /** True if a pending bulk approval was undone. */
  undo: () => boolean;
};

export function useDeskShortcuts({ enabled, ids, sections, section, onSection, onRefuse, bulk }: {
  /** Off while a non-queue section (e.g. Manage Employees) is shown. */
  enabled: boolean;
  /** Bill ids in display order. */
  ids: string[];
  sections: string[];
  section: string;
  onSection: (section: string) => void;
  /** Explain why a key did nothing, e.g. the bill cannot be decided here. */
  onRefuse: (text: string) => void;
  bulk?: BulkKeys;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [armed, setArmed] = useState<Armed>(null);
  const [help, setHelp] = useState(false);
  const lastIndex = useRef(0);
  const keyboard = useRef(false); // only move focus once the person is using the keys

  const select = (id: string) => {
    setCurrent(id);
    const el = card(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Keep a selection; when the selected bill leaves, take the one in its place.
  useEffect(() => {
    if (!ids.length) { setCurrent(null); return; }
    const at = current ? ids.indexOf(current) : -1;
    if (at >= 0) { lastIndex.current = at; return; }
    const next = ids[Math.min(lastIndex.current, ids.length - 1)];
    if (keyboard.current) select(next); else setCurrent(next);
    if (armed && !ids.includes(armed.id)) setArmed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => { lastIndex.current = 0; setArmed(null); }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabled || e.defaultPrevented || dialogOpen()) return;
      const target = e.target as HTMLElement;

      if (target.closest("input, textarea, select, [contenteditable='true']")) {
        if (target.matches("textarea[data-remark]")) {
          const owner = target.closest<HTMLElement>("[data-bill-card]");
          if (e.key === "Escape") { e.preventDefault(); setArmed(null); owner?.focus(); return; }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && owner) {
            e.preventDefault();
            const action = armed && armed.id === owner.dataset.billCard ? armed.action : null;
            if (action) press(owner, action);
            else onRefuse("Press H (hold) or R (reject) on the bill first, then Ctrl/⌘ + Enter.");
          }
        } else if (e.key === "Escape" && target.matches("input[type='search']")) {
          e.preventDefault();
          target.blur();
          if (current) card(current)?.focus({ preventScroll: true });
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const move = (step: number) => {
        if (!ids.length) return;
        e.preventDefault();
        keyboard.current = true;
        const at = current ? ids.indexOf(current) : -1;
        const next = ids[Math.max(0, Math.min(ids.length - 1, at + step))];
        // Shift ticks the bill left and the bill reached.
        if (e.shiftKey && bulk) { if (current) bulk.add(current); bulk.add(next); }
        select(next);
      };
      const here = current ? card(current) : null;

      switch (e.key) {
        case "j": case "J": case "ArrowDown": return move(1);
        case "k": case "K": case "ArrowUp": return move(-1);
        case "a": case "A":
          e.preventDefault(); keyboard.current = true;
          if (bulk && e.shiftKey) return bulk.selectAll();
          if (bulk && bulk.count > 0) return bulk.approve();
          if (!here) return;
          return press(here, "Approved");
        case "x": case "X": case " ":
          if (!bulk || !current || (e.key === " " && target.closest("button, a"))) return;
          e.preventDefault(); keyboard.current = true;
          return bulk.toggle(current);
        case "u": case "U":
          if (bulk?.undo()) e.preventDefault();
          return;
        case "Escape":
          if (bulk && bulk.count > 0) { e.preventDefault(); bulk.clear(); }
          return;
        case "h": case "H": case "r": case "R": {
          if (!here) return;
          e.preventDefault(); keyboard.current = true;
          const action = e.key.toLowerCase() === "h" ? "Hold" : "Rejected";
          const box = here.querySelector<HTMLTextAreaElement>("textarea[data-remark]");
          if (!box || box.closest("fieldset")?.disabled) return onRefuse("You cannot decide this bill here.");
          setArmed({ id: current!, action });
          box.focus();
          box.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        case "o": case "O": case "Enter":
          if (!current || (e.key === "Enter" && target.closest("button, a"))) return;
          e.preventDefault();
          window.open(`/bill/${current}`, "_blank", "noopener");
          return;
        case "/": {
          const search = document.querySelector<HTMLInputElement>("input[type='search']");
          if (!search) return;
          e.preventDefault();
          search.focus();
          search.select();
          return;
        }
        case "[": case "]": {
          const at = sections.indexOf(section);
          if (at < 0) return;
          e.preventDefault();
          onSection(sections[(at + (e.key === "]" ? 1 : sections.length - 1)) % sections.length]);
          return;
        }
        case "?":
          e.preventDefault();
          setHelp(true);
          return;
      }
    };

    function press(owner: HTMLElement, action: Decision) {
      const button = owner.querySelector<HTMLButtonElement>(`button[data-decision="${action}"]`);
      if (!button || button.disabled) return onRefuse("You cannot decide this bill here.");
      button.click();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { current, select: setCurrent, armed, help, closeHelp: () => setHelp(false) };
}
