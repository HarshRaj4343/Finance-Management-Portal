import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
afterEach(() => vi.unstubAllGlobals());
describe("complete work queues", () => {
  it("follows server cursors, preserving department filters and old pending bills", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ bills: [{ id: "new" }], nextCursor: "precise-time|id" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bills: [{ id: "old-pending" }], nextCursor: null })));
    vi.stubGlobal("fetch", fetch);
    expect((await api.bills("/api/bills?department=A&limit=100")).data?.bills).toEqual([{ id: "new" }, { id: "old-pending" }]);
    expect(fetch.mock.calls[1][0]).toContain("department=A"); expect(fetch.mock.calls[1][0]).toContain("cursor=");
  });
  it("does not present partial counts as complete when a later page fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ bills: [{}], nextCursor: "next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Failed" }), { status: 500 })));
    expect(await api.bills("/api/bills")).toEqual({ data: null, error: "Failed" });
  });
});
