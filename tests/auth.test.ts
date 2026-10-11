import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), bind: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ queryOne: mocks.queryOne }));
vi.mock("ldapjs", () => ({ default: { createClient: () => ({ on: vi.fn(), unbind: vi.fn(), bind: mocks.bind }) } }));
vi.stubEnv("LDAP_URL", "ldaps://example.test");
vi.stubEnv("LDAP_BASE_DN", "dc=example,dc=test");
vi.stubEnv("DEMO_LOGIN_ENABLED", "true");
vi.stubEnv("DEMO_PASSWORD", "123");
const { authOptions } = await import("@/server/auth-options");
const jwt = authOptions.callbacks!.jwt!;
const refresh = (token: JWT) => jwt({ token, account: null } as Parameters<typeof jwt>[0]);
const provider = authOptions.providers[0] as unknown as { options: { authorize: (c: { username: string; password: string }, req: unknown) => Promise<unknown> } };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DEMO_LOGIN_ENABLED", "true"); vi.stubEnv("DEMO_PASSWORD", "123"); mocks.queryOne.mockResolvedValue({ employee_code: "U", employee_name: "User", employee_type: "User", is_active: true }); mocks.bind.mockImplementation((_dn, _password, callback) => callback(null)); });
describe("LDAP sign-in and hard session expiry", () => {
  it("sets both token and session lifetime to eight hours", () => { expect(authOptions.session?.maxAge).toBe(28800); expect(authOptions.jwt?.maxAge).toBe(28800); });
  it("rechecks live roles without a browser update trigger", async () => {
    expect(await refresh({ employee_code: "U", employee_type: "Dean", signedInAt: Date.now() })).toMatchObject({ employee_type: "User" });
  });
  it("expires a continuously used session eight hours after sign-in", async () => {
    expect(await refresh({ employee_code: "U", signedInAt: Date.now() - 28800001 })).toEqual({});
  });
  it("fails closed when an employee becomes inactive or the database fails", async () => {
    mocks.queryOne.mockResolvedValue({ employee_code: "U", is_active: false });
    expect(await refresh({ employee_code: "U", signedInAt: Date.now() })).toEqual({});
    await expect(provider.options.authorize({ username: "U", password: "secret" }, {})).rejects.toThrow(/inactive/);
    mocks.queryOne.mockRejectedValue(new Error("Unavailable"));
    expect(await refresh({ employee_code: "U", signedInAt: Date.now() })).toEqual({});
  });
  it("retains demo login but uses the live database role rather than the account name", async () => {
    expect(await provider.options.authorize({ username: "Dean", password: "123" }, {})).toMatchObject({ employee_type: "User", ou: "demo" });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("rejects a wrong demo password without falling back to LDAP", async () => {
    await expect(provider.options.authorize({ username: "Dean", password: "wrong" }, {})).rejects.toThrow(/Invalid credentials/);
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("rejects inactive and missing demo accounts", async () => {
    mocks.queryOne.mockResolvedValue({ employee_code: "Dean", is_active: false });
    await expect(provider.options.authorize({ username: "Dean", password: "123" }, {})).rejects.toThrow(/inactive/);
    mocks.queryOne.mockResolvedValue(null);
    await expect(provider.options.authorize({ username: "Dean", password: "123" }, {})).rejects.toThrow(/not been provisioned/);
  });
  it("uses LDAP for non-demo identifiers and rejects DN injection", async () => {
    await provider.options.authorize({ username: "U", password: "secret" }, {});
    expect(mocks.bind).toHaveBeenCalledOnce();
    await expect(provider.options.authorize({ username: "U,ou=admins", password: "x" }, {})).rejects.toThrow(/Invalid credentials/);
  });
  it.each([
    { mode: "test", enabled: "false", password: "123" },
    { mode: "production", enabled: "true", password: undefined },
    { mode: "production", enabled: "true", password: "" },
    { mode: "production", enabled: undefined, password: "123" },
  ])("does not use demo login with config $mode/$enabled/$password", async ({ mode, enabled, password }) => {
    vi.stubEnv("NODE_ENV", mode); vi.stubEnv("DEMO_LOGIN_ENABLED", enabled); vi.stubEnv("DEMO_PASSWORD", password);
    vi.resetModules();
    const options = (await import("@/server/auth-options")).authOptions;
    const configuredProvider = options.providers[0] as unknown as typeof provider;
    expect(await configuredProvider.options.authorize({ username: "Dean", password: "123" }, {})).toMatchObject({ ou: "ldap" });
    expect(mocks.bind).toHaveBeenCalledOnce();
  });
  it("retains the default development demo password", async () => {
    vi.stubEnv("DEMO_LOGIN_ENABLED", undefined); vi.stubEnv("DEMO_PASSWORD", undefined); vi.resetModules();
    const options = (await import("@/server/auth-options")).authOptions;
    const configuredProvider = options.providers[0] as unknown as typeof provider;
    expect(await configuredProvider.options.authorize({ username: "Dean", password: "123" }, {})).toMatchObject({ ou: "demo" });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("allows explicitly configured production demo login and warns without exposing its password", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEMO_PASSWORD", "demo-secret"); vi.resetModules();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const options = (await import("@/server/auth-options")).authOptions;
      const configuredProvider = options.providers[0] as unknown as typeof provider;
      expect(await configuredProvider.options.authorize({ username: "Dean", password: "demo-secret" }, {})).toMatchObject({ ou: "demo" });
      expect(mocks.bind).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnce();
      expect(warning.mock.calls.flat().join(" ")).not.toContain("demo-secret");
    } finally { warning.mockRestore(); }
  });
});
