import type { Order, OrderLine, OrderPayment } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/card";
import { TRACKING_LABEL } from "@/lib/freight";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from "@/server/logistics/deliveries";
import type { OrderLogistics } from "@/server/logistics/tracking";
import { orderStateText, PAYMENT_LABEL } from "@/server/shop/orders";

export type ViewableOrder = Order & { lines: OrderLine[]; payments: OrderPayment[]; market: { locale: string; timeZone: string; name: string } };

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** Links to a delivery's papers, made by the page for whoever is looking. */
export interface DeliveryLinks {
  note: (number: string) => string;
  pod: (number: string) => string;
  commercialInvoice?: string;
}

/**
 * An order as the customer sees it: never costs or suppliers. With
 * `logistics`, each line shows where it is and the deliveries are listed;
 * staff also see who moved each step and why.
 */
export function OrderView({ order: o, staff = false, proFormaHref, invoice, logistics, links }: { order: ViewableOrder; staff?: boolean; proFormaHref?: string; invoice?: { number: string; href: string }; logistics?: OrderLogistics; links?: DeliveryLinks }) {
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
      {proFormaHref || invoice ? (
        <p className="-mt-2 flex flex-wrap gap-x-6 gap-y-1 text-callout">
          {invoice ? (
            <a href={invoice.href} className="font-semibold text-link underline underline-offset-4">
              Download tax invoice {invoice.number} (PDF)
            </a>
          ) : null}
          {proFormaHref ? (
            <a href={proFormaHref} className="text-link underline underline-offset-4">
              Download the pro forma invoice (PDF)
            </a>
          ) : null}
        </p>
      ) : null}

      {o.status === "CANCELLED" ? (
        <Alert>
          This order was cancelled{o.cancelReason ? `: ${o.cancelReason}` : ""}.{paid > 0n ? " We will refund what you paid." : ""}
        </Alert>
      ) : null}

      {(o.status === "AWAITING_PAYMENT" && o.paymentMethod === "BANK_TRANSFER") || (o.paymentMethod === "ACCOUNT" && o.status !== "CANCELLED" && o.paidAt === null && owing > 0n) ? (
        <section aria-labelledby="pay" className="rounded-lg border-2 border-brand bg-raised p-5">
          <h2 id="pay" className="text-headline font-bold">
            How to pay
          </h2>
          <p className="mt-2">
            Transfer {money(owing)} {o.payBy ? `by ${formatDate(o.payBy, locale, timeZone)}` : ""} and use <strong className="font-mono">{o.number}</strong> as the reference.{" "}
            {o.paymentMethod === "ACCOUNT" ? "It is on your account, so we send it before it is paid." : "Unpaid orders are cancelled after that date."}
          </p>
          <p className="mt-3 rounded-md bg-surface p-4 font-mono text-callout whitespace-pre-line">{o.bankDetails}</p>

          {paid > 0n ? <p className="mt-3 text-callout text-ink-muted">We have received {money(paid)} so far.</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="items">
        <h2 id="items" className="text-headline font-bold">
          Items
        </h2>
        {o.pricesIncludeTax ? null : <p className="mt-1 text-callout text-ink-muted">As quoted: prices per unit before {o.taxName}, with {o.taxName} added on the total.</p>}
        <div role="region" aria-label="Items in this order" tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-line">
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
                    {logistics && l.tracking ? (
                      <span className="mt-1 block">
                        <Badge tone={l.tracking === "DELIVERED" ? "positive" : "highlight"}>{TRACKING_LABEL[l.tracking]}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(l.lineTotalMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-raised">
              {o.pricesIncludeTax ? (
                <>
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
                </>
              ) : (
                <>
                  <tr className="border-t border-line">
                    <th scope="row" colSpan={2} className="px-4 py-2 text-right font-normal">
                      Subtotal
                    </th>
                    <td className="px-4 py-2 text-right tabular-nums">{money(o.subtotalMinor)}</td>
                  </tr>
                  <tr>
                    <th scope="row" colSpan={2} className="px-4 py-2 text-right font-normal">
                      {o.taxName} {o.taxRateBps / 100}%
                    </th>
                    <td className="px-4 py-2 text-right tabular-nums">{money(o.taxMinor)}</td>
                  </tr>
                </>
              )}
              <tr>
                <th scope="row" colSpan={2} className="px-4 py-2 text-right">
                  Total
                </th>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{money(o.totalMinor)}</td>
              </tr>
              {o.pricesIncludeTax ? (
                <tr>
                  <th scope="row" colSpan={2} className="px-4 pb-3 text-right text-caption font-normal text-ink-muted">
                    Includes {o.taxName}
                  </th>
                  <td className="px-4 pb-3 text-right text-caption text-ink-muted tabular-nums">{money(o.taxMinor)}</td>
                </tr>
              ) : null}
            </tfoot>
          </table>
        </div>
      </section>

      {logistics && (logistics.events.size || logistics.deliveries.length) ? (
        <section aria-labelledby="where" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="where" className="text-headline font-bold">
            Where it is
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {o.lines
              .filter((l) => logistics.events.has(l.id))
              .map((l) => (
                <li key={l.id}>
                  <details>
                    <summary className="cursor-pointer text-callout">
                      <span className="font-semibold">{l.description}</span>: {l.tracking ? TRACKING_LABEL[l.tracking] : "Not started"}
                    </summary>
                    <ol className="mt-2 ml-5 flex list-decimal flex-col gap-1 text-callout">
                      {logistics.events.get(l.id)!.map((e) => (
                        <li key={e.id}>
                          {TRACKING_LABEL[e.status]}, {formatDateTime(e.at, locale, timeZone)}
                          {staff ? <span className="text-ink-muted">{`, ${e.byLabel}${e.note ? `: ${e.note}` : ""}`}</span> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
          </ul>
          {logistics.deliveries.length ? (
            <>
              <h3 className="mt-5 font-bold">Deliveries</h3>
              <ul className="mt-2 flex flex-col gap-2 text-callout">
                {logistics.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.number}</span>
                    <Badge tone={DELIVERY_STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>
                    <span className="text-ink-muted">
                      {[items(d.lines.reduce((n, x) => n + x.quantity, 0)), d.carrier && `with ${d.carrier}`, d.reference && `tracking ${d.reference}`, d.dispatchedAt && `left ${formatDate(d.dispatchedAt, locale, timeZone)}`, d.deliveredAt && `signed for by ${d.receivedBy} on ${formatDate(d.deliveredAt, locale, timeZone)}`].filter(Boolean).join(", ")}
                    </span>
                    {links ? (
                      <>
                        <a href={links.note(d.number)} className="text-link underline underline-offset-4">
                          Delivery note
                        </a>
                        {d.podFilename ? (
                          <a href={links.pod(d.number)} className="text-link underline underline-offset-4">
                            Proof of delivery
                          </a>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {links?.commercialInvoice ? (
            <p className="mt-4 text-callout">
              <a href={links.commercialInvoice} className="text-link underline underline-offset-4">
                Commercial invoice for customs (PDF)
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

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
          <p className="mt-2 text-callout whitespace-pre-line">{[o.name, o.email, o.phone, PAYMENT_LABEL[o.paymentMethod], o.customerReference ? `Your reference: ${o.customerReference}` : ""].filter(Boolean).join("\n")}</p>
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
