import { TableWrap, td, th } from "@/components/ui/card";
import { DEFAULT_TIME_ZONE, company } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";

export interface PoLinesView {
  currency: string;
  totalMinor: bigint;
  lines: { id: string; position: number; description: string; mpn: string; quantity: number; unitCostMinor: bigint; lineTotalMinor: bigint; confirmedQuantity: number | null; shipDate: Date | null; serials: string; note: string }[];
}

/** A purchase order's lines with what the supplier said about each. The same for the supplier and for staff. */
export function PoLines({ po }: { po: PoLinesView }) {
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: po.currency }, company.staffLocale);
  const date = (d: Date) => formatDate(d, company.staffLocale, DEFAULT_TIME_ZONE);
  return (
    <TableWrap label="Purchase order lines">
      <table className="w-full min-w-[36rem] text-callout">
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={cn(th, "text-right")}>Qty</th>
            <th className={cn(th, "text-right")}>Each</th>
            <th className={cn(th, "text-right")}>Total</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id}>
              <td className={td}>
                <span className="font-semibold">
                  {l.position}. {l.description}
                </span>
                {l.mpn ? <span className="block text-caption text-ink-muted">Part {l.mpn}</span> : null}
                {l.confirmedQuantity !== null ? <span className="block text-caption font-semibold">Confirmed {l.confirmedQuantity} of {l.quantity}</span> : null}
                {l.shipDate ? <span className="block text-caption">Ships {date(l.shipDate)}</span> : null}
                {l.note ? <span className="block text-caption">Note: {l.note}</span> : null}
                {l.serials ? <span className="block text-caption break-all">Serial numbers: {l.serials.split("\n").join(", ")}</span> : null}
              </td>
              <td className={cn(td, "text-right tabular-nums")}>{l.quantity}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(l.unitCostMinor)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(l.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3} className="py-3 pr-4 text-right">
              Total, before tax
            </th>
            <td className="py-3 pr-4 text-right font-bold tabular-nums">{money(po.totalMinor)}</td>
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}
