const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole number in the Indian system: crore, lakh, thousand. */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${crore >= 1000 ? indianWords(crore) : belowThousand(crore)} Crore`);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5); if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  n %= 1e5;
  const thousand = Math.floor(n / 1000); if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** ₹1,25,000.50 -> "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only" */
export function amountInWords(amount: number | string | null | undefined): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return "";
  const paiseTotal = Math.round(value * 100);
  const rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100;
  const words = `Rupees ${indianWords(rupees)}`;
  return paise ? `${words} and ${belowHundred(paise)} Paise Only` : `${words} Only`;
}
