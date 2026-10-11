import type { Bill } from "@/types/database";
import { money } from "@/lib/api";
import { lineTotal, placeLabel } from "@/app/apply-bill/bill-form/model";

export default function BillItems({ bill }: { bill: Bill }) {
  if (!bill.form_data) return null;
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border-collapse">
        <caption className="text-left font-semibold mb-2">Item and price breakdown</caption>
        <thead><tr>{["Item", "Quantity", "Unit price", "Total", "Issued / custodian / location"].map((title) => <th key={title} className="border p-2 text-left">{title}</th>)}</tr></thead>
        <tbody>{bill.form_data.lines.map((line, index) => <tr key={index}>
          <td className="border p-2">{line.description}</td><td className="border p-2">{line.qty} {line.uom}</td>
          <td className="border p-2">{money(line.unitPrice.replace(/[₹,\s]/g, ""))}</td><td className="border p-2">{money(lineTotal(line))}</td>
          <td className="border p-2">{line.qtyIssued} / {line.custodian} / {placeLabel(line)}</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-2 text-sm">Other charges: {money(bill.form_data.otherCharges.replace(/[₹,\s]/g, ""))}</p>
    </div>
  );
}
