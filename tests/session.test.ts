import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), queryOne: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/server/auth-options", () => ({ authOptions: {} }));
vi.mock("@/server/db", () => ({ queryOne: mocks.queryOne }));
import { currentActor, requireRole } from "@/server/session";
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { employee_code: "U", employee_type: "Dean", provisioned: true } }); });
describe("live session authority", () => {
  it("ignores cached JWT privileges and reads the current employee role", async () => {
    mocks.queryOne.mockResolvedValue({ employee_code: "U", employee_name: "User", employee_type: "User", is_active: true });
    expect((await currentActor())?.role).toBe("User");
    await expect(requireRole("Dean")).rejects.toMatchObject({ status: 403 });
  });
  it("revokes deactivated and missing employees immediately", async () => {
    for (const value of [null, { employee_code: "U", is_active: false }]) { mocks.queryOne.mockResolvedValue(value); expect(await currentActor()).toBeNull(); }
  });
  it("does not grant access when the database is unavailable", async () => {
    mocks.queryOne.mockRejectedValue(new Error("Database unavailable"));
    await expect(currentActor()).rejects.toThrow("Database unavailable");
  });
});
