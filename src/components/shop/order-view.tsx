import type { Order, OrderLine, OrderPayment } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { orderStateText, PAYMENT_LABEL } from "@/server/shop/orders";

export type ViewableOrder = Order & { lines: OrderLine[]; payments: OrderPayment[]; market: { locale: string; timeZone: string; name: string } };

/** An order as the customer sees it: never costs or suppliers. */
export function OrderView({ order: o, staff = false }: { order: ViewableOrder; staff?: boolean }) {
  const { locale, timeZone } = o.market;
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency: o.currency }, locale);
  const paid = o.payments.reduce((s, p) => s + p.amountMinor, 0n);
  const owing = o.totalMinor - paid;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 rounded-lg border border-line bg-raised p-5 sm:grid-cols-3">
        <div>
          <dt className="text-caption font-semibold text-ink-muted uppercase">Status</dt>
          <dd className="mt-1 font-bold">{orderStateText(o)}</dd>
        </div>
        <div>
          <dt className="text-caption font-semibold text-ink-muted uppercase">Placed</dt>
          <dd className="mt-1">{formatDateTime(o.createdAt, locale, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-caption font-semibold text-ink-muted uppercase">Total</dt>
          <dd className="mt-1 font-bold tabular-nums">{money(o.totalMinor)}</dd>
        </div>
      </dl>

      {o.status === "CANCELLED" ? (
        <Alert>
          This order was cancelled{o.cancelReason ? `: ${o.cancelReason}` : ""}.{paid > 0n ? " We will refund what you paid." : ""}
        </Alert>
      ) : null}

      {o.status === "AWAITING_PAYMENT" && o.paymentMethod === "BANK_TRANSFER" ? (
        <section aria-labelledby="pay" className="rounded-lg border-2 border-brand bg-raised p-5">
          <h2 id="pay" className="text-headline font-bold">
            How to pay
          </h2>
          <p className="mt-2">
            Transfer {money(owing)} {o.payBy ? `by ${formatDate(o.payBy, locale, timeZone)}` : ""} and use <strong className="font-mono">{o.number}</strong> as the reference. Unpaid orders are cancelled after that date.
          </p>
          <p className="mt-3 rounded-md bg-surface p-4 font-mono text-callout whitespace-pre-line">{o.bankDetails}</p>
          {paid > 0n ? <p className="mt-3 text-callout text-ink-muted">We have received {money(paid)} so far.</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="items">
        <h2 id="items" className="text-headline font-bold">
          Items
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-callout">
            <thead className="bg-surface text-caption text-ink-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Qty
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-raised">
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{l.description}</span>
                    {l.mpn ? <span className="block text-caption text-ink-muted">Part {l.mpn}</span> : null}
                    {l.specialName ? <span className="block text-caption font-semibold text-link">{l.specialName}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(l.lineTotalMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-raised">
              <tr className="border-t border-line">
                <th scope="row" colSpan={2} className="px-4 py-2 text-right font-normal">
                  Items
                </th>
                <td className="px-4 py-2 text-right tabular-nums">{money(o.subtotalMinor)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2} className="px-4 py-2 text-right font-normal">
                  {o.fulfilment === "DELIVERY" ? "Delivery" : "Collection"}
                </th>
                <td className="px-4 py-2 text-right tabular-nums">{o.deliveryMinor > 0n ? money(o.deliveryMinor) : "Free"}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2} className="px-4 py-2 text-right">
                  Total
                </th>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{money(o.totalMinor)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2} className="px-4 pb-3 text-right text-caption font-normal text-ink-muted">
                  Includes {o.taxName}
                </th>
                <td className="px-4 pb-3 text-right text-caption text-ink-muted tabular-nums">{money(o.taxMinor)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="getting" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="getting" className="font-bold">
            {o.fulfilment === "DELIVERY" ? "Delivery to" : "Collect from"}
          </h2>
          <p className="mt-2 text-callout whitespace-pre-line">{o.fulfilment === "DELIVERY" ? [o.name, o.addressLine1, o.addressLine2, [o.city, o.postalCode].filter(Boolean).join(" ")].filter(Boolean).join("\n") : o.collectionText}</p>
        </section>
        <section aria-labelledby="contact" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="contact" className="font-bold">
            Contact and payment
          </h2>
          <p className="mt-2 text-callout whitespace-pre-line">{[o.name, o.email, o.phone, PAYMENT_LABEL[o.paymentMethod]].join("\n")}</p>
        </section>
      </div>
      {o.notes ? (
        <section aria-labelledby="notes" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="notes" className="font-bold">
            {staff ? "Note from the customer" : "Your note"}
          </h2>
          <p className="mt-2 text-callout whitespace-pre-line">{o.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
