import type { Bill } from "@/types/database";
import { money } from "@/lib/api";
import { lineTotal, placeLabel } from "@/app/apply-bill/bill-form/model";

/** Bills filed before the field was removed may still carry other charges. */
function legacyCharges(bill: Bill): number {
  const raw = (bill.form_data as { otherCharges?: unknown } | null)?.otherCharges;
  const value = Number(String(raw ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

export default function BillItems({ bill }: { bill: Bill }) {
  if (!bill.form_data) return null;
  return (
    <div className="overflow-x-auto py-3">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">Item and price breakdown</caption>
        <thead><tr>{["Item", "Quantity", "Unit price", "Total", "Issued / custodian / location"].map((title) => <th scope="col" key={title} className="border-b border-slate-200 px-2 py-2 text-left text-xs font-medium text-slate-500">{title}</th>)}</tr></thead>
        <tbody>{bill.form_data.lines.map((line, index) => <tr key={index}>
          <td className="border-b border-slate-100 px-2 py-2">{line.description}</td><td className="border-b border-slate-100 px-2 py-2">{line.qty} {line.uom}</td>
          <td className="border-b border-slate-100 px-2 py-2">{money(line.unitPrice.replace(/[₹,\s]/g, ""))}</td><td className="border-b border-slate-100 px-2 py-2">{money(lineTotal(line))}</td>
          <td className="border-b border-slate-100 px-2 py-2">{line.qtyIssued} / {line.custodian} / {placeLabel(line)}</td>
        </tr>)}</tbody>
      </table>
      {legacyCharges(bill) > 0 && <p className="mt-2 text-sm">Other charges (older form): {money(legacyCharges(bill))}</p>}
    </div>
  );
}
