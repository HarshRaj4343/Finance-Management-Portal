// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill } from "@/types/database";
import DeskReviewPanel from "@/components/DeskReviewPanel";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { post: mocks.post }, money: (n: number) => `₹${Number(n).toFixed(2)}`, when: (t: string) => t }));
vi.mock("@/app/apply-bill/UploadBill", () => ({ default: () => <form aria-label="bill form" /> }));

const bill = { id: "00000000-0000-4000-8000-000000000002", bill_number: "TEST/2", revision: 5,
  employee_id: "TEST-U", employee_name: "Test applicant", created_by: "TEST-C", po_value: 90000,
  item_category: "Major", status: "Finance Admin", snp: "Approved", audit: "Approved", finance_admin: "Pending",
  funding_pool: "PDA", returned_from: null, returned_remark: null, returned_at: null } as Bill;
let root: Root;
let host: HTMLDivElement;
const onDecided = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(value: Bill = bill, desk: "Audit" | "Finance Admin" = "Finance Admin", code = "TEST-F") {
  await act(async () => root.render(<DeskReviewPanel bill={value} desk={desk} actorCode={code} actorRole={desk} onDecided={onDecided} />));
}
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === name);
  expect(found, `button ${name}`).toBeTruthy(); return found!;
}
async function click(name: string) { await act(async () => button(name).click()); }
async function pick(label: string) {
  const option = [...dialog()!.querySelectorAll("label")].find(l => l.textContent?.includes(label))!.querySelector("input")!;
  await act(async () => option.click());
}
async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Reject asks where the bill goes", () => {
  it("offers the earlier desks that approved it, the filer, and permanent rejection, defaulting to rejection", async () => {
    await render(); await click("Reject");
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("Where should this bill go?");
    for (const option of ["Send back to Store and Purchase Department", "Send back to Audit", "Send back to the filer", "Reject permanently"]) expect(text).toContain(option);
    expect(dialog()!.querySelector<HTMLInputElement>("input:checked")!.value).toBe("reject");
    expect(document.activeElement).toBe(button("Cancel"));
    await click("Cancel"); expect(dialog()).toBeNull(); expect(mocks.post).not.toHaveBeenCalled();
  });

  it("sends a bill back to a chosen desk without a remark", async () => {
    mocks.post.mockResolvedValue({ data: { bill: { ...bill, status: "Audit", audit: "Pending", finance_admin: "Returned", revision: 6 } }, error: null });
    await render(); await click("Reject"); await pick("Send back to Audit");
    expect(dialog()!.textContent).toContain("Remark (optional)");
    await click("Send back");
    expect(mocks.post).toHaveBeenCalledWith(`/api/bills/${bill.id}/action`,
      { action: "Returned", remark: undefined, expected_revision: 5, extra: { return_to: "Audit" } });
    expect(dialog()).toBeNull();
    expect(onDecided).toHaveBeenCalledWith(expect.objectContaining({ status: "Audit" }), "Sent back to Audit. Its funds remain reserved.");
  });

  it("requires a remark to reject permanently or send back to the filer, and carries the typed remark over", async () => {
    mocks.post.mockResolvedValue({ data: { bill: { ...bill, finance_admin: "Hold", revision: 6 } }, error: null });
    await render(); await click("Reject"); await click("Reject bill");
    expect(dialog()!.textContent).toContain("Write a remark to reject it."); expect(mocks.post).not.toHaveBeenCalled();
    await pick("Send back to the filer"); await click("Send to filer");
    expect(dialog()!.textContent).toContain("Write a remark to send it back to the filer.");
    await type(dialog()!.querySelector("textarea")!, "Invoice is unsigned");
    await click("Send to filer");
    expect(mocks.post).toHaveBeenCalledWith(`/api/bills/${bill.id}/action`, expect.objectContaining({ action: "Hold", remark: "Invoice is unsigned" }));

    await render({ ...bill, revision: 7 }); await type(host.querySelector("textarea")!, "Duplicate invoice"); await click("Reject");
    expect(dialog()!.querySelector("textarea")!.value).toBe("Duplicate invoice");
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    mocks.post.mockResolvedValue({ data: null, error: "Audit has not approved this bill, so it cannot be sent back there." });
    await render(); await click("Reject"); await pick("Send back to Audit"); await click("Send back");
    expect(dialog()!.textContent).toContain("cannot be sent back there");
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("asks for a remark first when there is no earlier desk to send it back to", async () => {
    await render({ ...bill, item_category: "Consumables", po_value: 1000, snp: null, audit: null });
    await click("Reject");
    expect(dialog()).toBeNull(); expect(host.textContent).toContain("Write a remark");
    await type(host.querySelector("textarea")!, "Wrong vendor"); await click("Reject");
    expect(dialog()!.textContent).not.toContain("Send back to Audit");
    expect(dialog()!.textContent).toContain("Reject permanently");
  });

  it("tells the receiving desk who sent it back and why, with the correction form", async () => {
    await render({ ...bill, status: "Audit", audit: "Pending", finance_admin: "Returned", returned_from: "Finance Admin",
      returned_remark: "Recheck the quoted rate", returned_at: "2026-10-16 15:00:00+05:30" }, "Audit", "TEST-A");
    expect(host.textContent).toContain("Sent back by Finance Admin");
    expect(host.textContent).toContain("Recheck the quoted rate");
    await click("Correct bill");
    expect(document.querySelector('form[aria-label="bill form"]')).toBeTruthy();
  });
});
