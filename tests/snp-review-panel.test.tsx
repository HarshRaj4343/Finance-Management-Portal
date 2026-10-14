// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill } from "@/types/database";
import SnpReviewPanel from "@/components/SnpReviewPanel";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { post: mocks.post }, money: (n: number) => `₹${Number(n).toFixed(2)}` }));

const bill = { id: "00000000-0000-4000-8000-000000000001", bill_number: "TEST/1", revision: 3,
  employee_id: "TEST-U", employee_name: "Test applicant", created_by: "TEST-C", po_value: 1000,
  status: "Student Purchase", snp: "Pending", date_of_delivery: "2026-01-02", date_of_installation: null,
  bill_details: "Delivered 02 Jan 2026. No installation required.", has_bank_guarantee: false,
  bank_guarantee_details: null, bank_guarantee_amount: null, form_data: null } as Bill;
let root: Root;
let host: HTMLDivElement;
const onDecided = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(value = bill, role = "SNP") {
  await act(async () => root.render(<SnpReviewPanel bill={value} actorCode="TEST-S" actorRole={role} onDecided={onDecided} />));
}
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === name);
  expect(found, `button ${name}`).toBeTruthy(); return found!;
}
async function click(name: string) { await act(async () => button(name).click()); }
async function remark(value: string) {
  const field = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Store and Purchase confirmation UI (no live API or financial writes)", () => {
  it("shows dates without a guarantee and removes JSON controls", async () => {
    await render();
    expect(host.textContent).toContain("02 Jan 2026"); expect(host.textContent).toContain("Not required");
    expect(host.textContent).not.toContain("JSON");
    for (const action of ["Approve", "Hold", "Reject"]) expect(button(action).disabled).toBe(false);
  });
  it("opens an accessible approve summary and cancels without sending a request", async () => {
    await render(); await click("Approve");
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Confirm approve"); expect(dialog?.textContent).toContain("TEST/1");
    expect(dialog?.textContent).toContain("₹1000.00"); expect(dialog?.textContent).toContain("02 Jan 2026");
    expect(document.activeElement).toBe(button("Cancel")); expect(mocks.post).not.toHaveBeenCalled();
    await click("Cancel"); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Approve")));
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(["Hold", "Reject"])("requires a remark and a separate confirmation for %s", async (action) => {
    await render(); await click(action);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.textContent).toContain("Write a remark");
    await remark("Please correct the invoice."); await click(action);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Please correct the invoice.");
    expect(mocks.post).not.toHaveBeenCalled(); await click("Cancel"); expect(mocks.post).not.toHaveBeenCalled();
  });
  it("sends the reviewed revision only after confirmation and guards same-tick duplicate clicks", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render(); await click("Approve");
    await act(async () => { button("Confirm Approve").click(); button("Confirm Approve").click(); });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(`/api/bills/${bill.id}/action`, expect.objectContaining({ action: "Approved", expected_revision: 3 }));
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => finish({ data: { bill: { ...bill, revision: 4, status: "Finance Admin", snp: "Approved" } } }));
    expect(onDecided).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("refuses a changed revision even when a confirmation was already opened", async () => {
    await render(); await click("Approve"); await render({ ...bill, revision: 4 }); await click("Confirm Approve");
    expect(mocks.post).not.toHaveBeenCalled(); expect(host.textContent).toContain("The bill has changed");
  });
  it("does not show actions for an unrelated desk or a completed bill", async () => {
    await render(bill, "Audit"); expect(host.querySelector("fieldset")).toBeNull();
    await render({ ...bill, status: "Accepted", snp: "Approved" }); expect(host.querySelector("fieldset")).toBeNull();
    expect(host.textContent).toContain("Date of Delivery");
  });
});
