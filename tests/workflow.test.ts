import { describe, it, expect } from "vitest";
import {
  routeAfter,
  plannedRoute,
  normaliseRole,
  homeFor,
  canSeeAllBills,
  isApprover,
  AUDIT_THRESHOLD,
  ROLES,
  ROLE_HOME,
} from "@/lib/roles";

/**
 * These cover the rules the UI applies. The money itself is tested against
 * a real Postgres in scripts/test_workflow.sql, because that is where the
 * transactions live -- there is no point asserting in TypeScript that a
 * rejection refunds a PDA when the database is the thing doing it.
 *
 * What matters here is that these two never disagree: fn_route_after in
 * 0002_functions.sql and routeAfter in src/lib/roles.ts describe the same
 * routing, and if they drift, a filer is shown the wrong destination.
 */

describe("routing by amount and category", () => {
  it("sends major and minor purchases to Student Purchase first", () => {
    expect(routeAfter("Submit", "Major", 1000)).toBe("Student Purchase");
    expect(routeAfter("Submit", "Minor", 1000)).toBe("Student Purchase");
    expect(routeAfter("Submit", "Major", 900000)).toBe("Student Purchase");
  });

  it("skips Student Purchase entirely for consumables", () => {
    expect(routeAfter("Submit", "Consumables", 1000)).toBe("Finance Admin");
    expect(routeAfter("Submit", "Consumables", 90000)).toBe("Audit");
  });

  it("routes above the threshold through Audit", () => {
    expect(routeAfter("Student Purchase", "Minor", 50001)).toBe("Audit");
    expect(routeAfter("Student Purchase", "Minor", 49999)).toBe("Finance Admin");
  });

  it("treats the threshold itself as below the line", () => {
    // ₹50,000 exactly must NOT go to Audit. An off-by-one here sends every
    // bill at the boundary to the wrong desk.
    expect(AUDIT_THRESHOLD).toBe(50000);
    expect(routeAfter("Student Purchase", "Minor", AUDIT_THRESHOLD)).toBe("Finance Admin");
    expect(routeAfter("Submit", "Consumables", AUDIT_THRESHOLD)).toBe("Finance Admin");
    expect(routeAfter("Student Purchase", "Minor", AUDIT_THRESHOLD + 0.01)).toBe("Audit");
  });

  it("always ends at Finance Admin after Audit", () => {
    expect(routeAfter("Audit", "Major", 1)).toBe("Finance Admin");
    expect(routeAfter("Audit", "Consumables", 10_000_000)).toBe("Finance Admin");
  });
});

describe("the full planned route", () => {
  it("gives a small minor purchase two desks", () => {
    expect(plannedRoute("Minor", 20000)).toEqual(["Student Purchase", "Finance Admin"]);
  });

  it("gives a large major purchase three", () => {
    expect(plannedRoute("Major", 200000)).toEqual([
      "Student Purchase",
      "Audit",
      "Finance Admin",
    ]);
  });

  it("gives a small consumable exactly one", () => {
    expect(plannedRoute("Consumables", 5000)).toEqual(["Finance Admin"]);
  });

  it("gives a large consumable two, without Student Purchase", () => {
    expect(plannedRoute("Consumables", 75000)).toEqual(["Audit", "Finance Admin"]);
    expect(plannedRoute("Consumables", 75000)).not.toContain("Student Purchase");
  });

  it("always terminates at Finance Admin, whatever the inputs", () => {
    for (const cat of ["Major", "Minor", "Consumables"]) {
      for (const amt of [1, 49999, 50000, 50001, 1e9]) {
        const route = plannedRoute(cat, amt);
        expect(route.at(-1)).toBe("Finance Admin");
        expect(route.length).toBeLessThanOrEqual(3);
        // No desk should appear twice.
        expect(new Set(route).size).toBe(route.length);
      }
    }
  });
});

describe("role normalisation", () => {
  it("accepts the spellings that exist in the old data", () => {
    expect(normaliseRole("pda-manager")).toBe("PDA Manager");
    expect(normaliseRole("pda manager")).toBe("PDA Manager");
    expect(normaliseRole("bill_employee_fill")).toBe("Bill Employee");
    expect(normaliseRole("bill_employee_edit")).toBe("Bill Editor");
    expect(normaliseRole("Bill-form")).toBe("Bill Employee");
    expect(normaliseRole("Bill-edit")).toBe("Bill Editor");
    expect(normaliseRole("SNP")).toBe("Student Purchase");
  });

  it("copes with stray whitespace and casing", () => {
    expect(normaliseRole("  audit ")).toBe("Audit");
    expect(normaliseRole("FINANCE ADMIN")).toBe("Finance Admin");
    expect(normaliseRole("Student   Purchase")).toBe("Student Purchase");
  });

  it("falls back to User rather than to nothing", () => {
    // An unrecognised role must never grant more than a plain user has.
    expect(normaliseRole(null)).toBe("User");
    expect(normaliseRole(undefined)).toBe("User");
    expect(normaliseRole("")).toBe("User");
    expect(normaliseRole("Chief Wizard")).toBe("User");
  });

  it("maps the retired Finance Employee role to User", () => {
    // It was in the database CHECK constraint and the login route map, but
    // /finance-employee never existed. Anyone carrying it used to be sent
    // to a 404.
    expect(normaliseRole("Finance Employee")).toBe("User");
    expect(homeFor("Finance Employee")).toBe("/user");
  });
});

describe("landing pages", () => {
  it("gives every role a route that exists", () => {
    const real = new Set([
      "/user",
      "/apply-bill",
      "/bill-editor",
      "/student-purchase",
      "/audit",
      "/finance-admin",
      "/pda-manager",
      "/admin",
    ]);
    for (const role of ROLES) {
      expect(real.has(ROLE_HOME[role])).toBe(true);
    }
  });

  it("never leaves anybody without a destination", () => {
    for (const raw of ["", "nonsense", "SNP", "pda-manager", null]) {
      expect(homeFor(raw).startsWith("/")).toBe(true);
    }
  });
});

describe("visibility", () => {
  it("keeps a plain user to their own bills", () => {
    expect(canSeeAllBills("User")).toBe(false);
  });

  it("lets every workflow role see the whole queue", () => {
    for (const role of ROLES.filter((r) => r !== "User")) {
      expect(canSeeAllBills(role)).toBe(true);
    }
  });

  it("recognises exactly the three approval desks", () => {
    expect(ROLES.filter(isApprover)).toEqual([
      "Student Purchase",
      "Audit",
      "Finance Admin",
    ]);
  });

  it("does not let the Dean approve bills", () => {
    // The Dean assigns roles. That is not the same as sitting at a desk.
    expect(isApprover("Dean")).toBe(false);
    expect(isApprover("PDA Manager")).toBe(false);
    expect(isApprover("Bill Employee")).toBe(false);
  });
});
