import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { istStamp, pickColumns, toCsv, type CsvColumn } from "@/server/csv";

describe("spreadsheet export", () => {
  it("quotes, neutralises formulas and marks the file as UTF-8 for Excel", () => {
    const csv = toCsv<{ a: unknown; b: unknown }>([["Name", (r) => r.a], ["Value", (r) => r.b]], [
      { a: 'Traders, "Mandi"', b: "=HYPERLINK(\"http://x\")" },
      { a: "-12.50", b: "@SUM(A1)" },
      { a: "₹ धन", b: null },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Name,Value");
    expect(lines[1]).toBe('"Traders, ""Mandi""","\'=HYPERLINK(""http://x"")"');
    expect(lines[2]).toBe("-12.50,'@SUM(A1)");
    expect(lines[3]).toBe("₹ धन,");
  });
  it("keeps the chosen columns in the file's own order, or every column when none is chosen", () => {
    const columns: CsvColumn<object>[] = [["A", () => 1], ["B", () => 2], ["C", () => 3]];
    const pick = (q: string) => pickColumns(columns, new URLSearchParams(q)).map(([h]) => h);
    expect(pick("")).toEqual(["A", "B", "C"]);
    expect(pick("col=C&col=A")).toEqual(["A", "C"]);
    expect(() => pick("col=Z")).toThrow(/at least one column/);
  });
  it("writes timestamps in IST", () => {
    expect(istStamp("2026-10-14T18:30:00Z")).toBe("2026-10-15 00:00");
    expect(istStamp("2026-10-14 21:04:00+05:30")).toBe("2026-10-14 21:04");
  });
});
