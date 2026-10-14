import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/amount-words";

describe("amount in words (Indian system)", () => {
  it("writes lakh and crore, with paise", () => {
    expect(amountInWords(5000)).toBe("Rupees Five Thousand Only");
    expect(amountInWords(125000.5)).toBe("Rupees One Lakh Twenty Five Thousand and Fifty Paise Only");
    expect(amountInWords(40000000)).toBe("Rupees Four Crore Only");
    expect(amountInWords(1999999.99)).toBe("Rupees Nineteen Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords("NaN")).toBe("");
  });
});
