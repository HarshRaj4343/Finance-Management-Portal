// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill } from "@/types/database";
import { useBulkApproval } from "@/components/BulkApproval";
import { useDeskShortcuts } from "@/components/DeskShortcuts";
import type { NoticeState } from "@/components/Notice";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: { post: mocks.post },
  money: (n: number) => `₹${Number(n).toLocaleString("en-IN")}`,
}));

const bill = (n: number, po_value = 1000) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, bill_number: `TEST/${n}`, revision: 2, po_value,
  status: "Finance Admin", finance_admin: "Pending", item_category: "Minor", source_of_fund: "PDA", supplier_name: "Traders",
} as unknown as Bill);

let notices: NoticeState[] = [];
/** DeskQueue's wiring, with simple cards. */
function Queue({ initial }: { initial: Bill[] }) {
  const [bills, setBills] = useState(initial);
  const bulk = useBulkApproval({
    desk: "Finance Admin", shown: bills, canDecide: () => true,
    replace: (u) => setBills((all) => all.filter((b) => b.id !== u.id)), notify: (n) => { notices.push(n); },
  });
  const keys = useDeskShortcuts({
    enabled: true, ids: bills.map((b) => b.id), sections: ["Pending"], section: "Pending",
    onSection: () => {}, onRefuse: (text) => notices.push({ kind: "info", text }), bulk: bulk.keys,
  });
  return (
    <>
      {bills.map((b) => (
        <div key={b.id} data-bill-card={b.id} tabIndex={-1} data-current={keys.current === b.id}>{bulk.tickBox(b)}</div>
      ))}
      {bulk.bar}
    </>
  );
}

let root: Root;
let host: HTMLDivElement;
const render = async (bills: Bill[]) => act(async () => root.render(<Queue initial={bills} />));
beforeEach(() => {
  vi.clearAllMocks(); notices = [];
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", vi.fn(() => true));
  Element.prototype.scrollIntoView = vi.fn();
  mocks.post.mockImplementation(async (_url: string, body: { bills: { id: string }[] }) => ({
    data: { approved: body.bills.length, failed: 0, total: 0, outcomes: body.bills.map((b) => ({ id: b.id, bill_number: null, ok: true, bill: { id: b.id } })) },
    error: null,
  }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const press = async (key: string, init: KeyboardEventInit = {}) =>
  act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const ticked = () => [...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].filter((c) => c.checked).length;

describe("bulk approval on a desk", () => {
  it("ticks with X and Shift+J, confirms once, and sends only after the undo window", async () => {
    await render([bill(1), bill(2), bill(3), bill(4)]);
    await press("x");
    await press("J", { shiftKey: true });
    await press("J", { shiftKey: true });
    expect(ticked()).toBe(3);
    expect(host.textContent).toContain("3 selected");

    await press("a");
    expect(window.confirm).toHaveBeenCalledOnce(); // one confirmation for the batch
    expect(host.textContent).toMatch(/Approving 3 bills/);
    await act(async () => { vi.advanceTimersByTime(7_900); });
    expect(mocks.post).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mocks.post).toHaveBeenCalledWith("/api/bills/bulk-action", { bills: [1, 2, 3].map((n) => ({ id: bill(n).id, expected_revision: 2 })) });
    expect(host.querySelectorAll("[data-bill-card]")).toHaveLength(1);
    expect(notices.at(-1)).toMatchObject({ kind: "ok", text: expect.stringContaining("3 bills approved") });
  });

  it("undo with U sends nothing and keeps the ticks", async () => {
    await render([bill(1), bill(2)]);
    await press("A", { shiftKey: true });
    expect(ticked()).toBe(2);
    await press("a");
    await press("u");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(ticked()).toBe(2);
    await press("Escape");
    expect(ticked()).toBe(0);
  });

  it("keeps to 75 bills and ₹25 lakh, and leaves out bills above ₹5 lakh", async () => {
    await render(Array.from({ length: 9 }, (_, i) => bill(i + 1, i === 0 ? 600000 : 400000)));
    expect(host.textContent).toContain("approve this bill on its own");
    await press("A", { shiftKey: true });
    // Bill 1 is above ₹5 lakh; six ₹4 lakh bills reach ₹24 lakh, a seventh would pass ₹25 lakh.
    expect(ticked()).toBe(6);
    expect(notices.at(-1)!.text).toMatch(/batch limit/);
    expect(notices.at(-1)!.text).toMatch(/1 left out/);
  });
});
