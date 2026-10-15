// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill } from "@/types/database";
import DeskReviewPanel from "@/components/DeskReviewPanel";
import { useDeskShortcuts } from "@/components/DeskShortcuts";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { post: mocks.post }, money: (n: number) => `₹${Number(n).toFixed(2)}` }));

const bill = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, bill_number: `TEST/${n}`, revision: 1, employee_id: "TEST-U",
  employee_name: "Applicant", created_by: "TEST-C", po_value: 100 * n, status: "Finance Admin", finance_admin: "Pending",
  editable_until: null,
} as unknown as Bill);

const refused = vi.fn();
/** The queue as DeskQueue lays it out: one data-bill-card per bill, the real decision panel inside. */
function Queue() {
  const [bills, setBills] = useState([bill(1), bill(2), bill(3)]);
  const keys = useDeskShortcuts({
    enabled: true, ids: bills.map((b) => b.id), sections: ["Pending", "All"], section: "Pending",
    onSection: () => {}, onRefuse: refused,
  });
  return (
    <>
      <input type="search" aria-label="Search" />
      {bills.map((b) => (
        <div key={b.id} data-bill-card={b.id} tabIndex={-1} data-current={keys.current === b.id}>
          <DeskReviewPanel bill={b} desk="Finance Admin" actorCode="TEST-F" actorRole="Finance Admin"
            onDecided={(u) => setBills((all) => all.filter((x) => x.id !== u.id))} />
        </div>
      ))}
    </>
  );
}

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", vi.fn(() => true)); // useConfirm falls back to window.confirm outside its provider
  vi.stubGlobal("open", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  mocks.post.mockImplementation(async (url: string, body: { action: string }) => ({
    data: { bill: { id: url.split("/")[3], finance_admin: body.action === "Approved" ? "Approved" : body.action === "Hold" ? "Hold" : "Reject" } },
    error: null,
  }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<Queue />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const current = () => host.querySelector('[data-current="true"]')?.getAttribute("data-bill-card");
const press = async (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const type = async (field: HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("desk keyboard shortcuts", () => {
  it("moves the selection with J / K and the arrow keys, within the list", async () => {
    expect(current()).toBe(bill(1).id);
    await press("j"); expect(current()).toBe(bill(2).id);
    await press("ArrowDown"); await press("j"); expect(current()).toBe(bill(3).id);
    await press("k"); expect(current()).toBe(bill(2).id);
    await press("ArrowUp"); await press("ArrowUp"); expect(current()).toBe(bill(1).id);
  });

  it("approves the selected bill through the normal confirmation, then selects the next", async () => {
    await press("j");
    await press("a");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith(`/api/bills/${bill(2).id}/action`, expect.objectContaining({ action: "Approved", expected_revision: 1 }));
    expect(host.querySelector(`[data-bill-card="${bill(2).id}"]`)).toBeNull();
    expect(current()).toBe(bill(3).id);
  });

  it("holds with a typed remark: H, type, Ctrl+Enter", async () => {
    await press("h");
    const box = host.querySelector<HTMLTextAreaElement>(`[data-bill-card="${bill(1).id}"] textarea[data-remark]`)!;
    expect(document.activeElement).toBe(box);
    await press("j", {}, box); // typing, not moving
    expect(current()).toBe(bill(1).id);
    await type(box, "Invoice copy unclear");
    await press("Enter", { ctrlKey: true }, box);
    expect(mocks.post).toHaveBeenCalledWith(`/api/bills/${bill(1).id}/action`, expect.objectContaining({ action: "Hold", remark: "Invoice copy unclear" }));
    expect(current()).toBe(bill(2).id);
  });

  it("never decides from the remark box unless H or R chose the action, and Esc leaves it", async () => {
    const box = host.querySelector<HTMLTextAreaElement>("textarea[data-remark]")!;
    box.focus();
    await type(box, "Something");
    await press("Enter", { metaKey: true }, box);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalled();
    await press("Escape", {}, box);
    expect(document.activeElement).not.toBe(box);
  });

  it("ignores shortcuts while typing in search, and / jumps to it", async () => {
    const search = host.querySelector<HTMLInputElement>("input[type='search']")!;
    await press("/");
    expect(document.activeElement).toBe(search);
    await press("a", {}, search);
    expect(mocks.post).not.toHaveBeenCalled();
    await press("Escape", {}, search);
    await press("o");
    expect(window.open).toHaveBeenCalledWith(`/bill/${bill(1).id}`, "_blank", "noopener");
  });
});
