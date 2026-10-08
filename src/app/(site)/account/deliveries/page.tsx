import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { TRACKING_LABEL } from "@/lib/freight";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerDeliveries, itemsOnTheWay } from "@/server/portal/overview";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Deliveries" };

const STATUS = { PREPARED: "Being packed", DISPATCHED: "On its way", DELIVERED: "Delivered" } as const;
const TONE = { PREPARED: "neutral", DISPATCHED: "warning", DELIVERED: "positive" } as const;

export default async function DeliveriesPage() {
  const v = await portalViewer("/account/deliveries");
  const [items, deliveries] = await Promise.all([itemsOnTheWay(prisma, v), customerDeliveries(prisma, v)]);
  return (
    <>
      <PageHeader title="Deliveries and tracking" lead="Where everything you have ordered is, and every delivery with its delivery note and proof of delivery." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          <h2 className="text-headline font-bold">On the way</h2>
          {items.length ? (
            <TableWrap label="Items on the way">
              <table className="mt-3 w-full min-w-[34rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Order</th>
                    <th className={th}>Item</th>
                    <th className={th}>Where it is</th>
                    <th className={th}>Since</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id}>
                      <td className={td}>
                        <Link href={`/orders/${encodeURIComponent(l.order.number)}`} className="text-link underline underline-offset-4">
                          {l.order.number}
                        </Link>
                      </td>
                      <td className={td}>
                        {l.quantity} x {l.description}
                      </td>
                      <td className={td}>{l.tracking ? TRACKING_LABEL[l.tracking] : ""}</td>
                      <td className={td}>{l.trackingEvents[0] ? formatDateTime(l.trackingEvents[0].at, l.order.market.locale, l.order.market.timeZone) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2">Nothing on the way just now.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Deliveries</h2>
          {deliveries.length ? (
            <ul className="mt-3 divide-y divide-line">
              {deliveries.map((d) => {
                const { locale, timeZone } = d.order.market;
                const base = `/orders/${encodeURIComponent(d.order.number)}/deliveries/${encodeURIComponent(d.number)}`;
                return (
                  <li key={d.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        <span className="font-bold text-ink">{d.number}</span>
                        <span className="text-ink-muted">
                          {" "}
                          for order{" "}
                          <Link href={`/orders/${encodeURIComponent(d.order.number)}`} className="text-link underline underline-offset-4">
                            {d.order.number}
                          </Link>
                        </span>
                      </span>
                      <Badge tone={TONE[d.status]}>{STATUS[d.status]}</Badge>
                    </div>
                    <p className="text-callout text-ink-muted">
                      {d.dispatchedAt ? `Left us ${formatDate(d.dispatchedAt, locale, timeZone)}` : ""}
                      {d.carrier ? ` with ${d.carrier}` : ""}
                      {d.reference ? `, reference ${d.reference}` : ""}
                      {d.deliveredAt ? `. Delivered ${formatDate(d.deliveredAt, locale, timeZone)}${d.receivedBy ? `, signed for by ${d.receivedBy}` : ""}` : ""}.
                    </p>
                    <p className="text-callout">{d.lines.map((l) => `${l.quantity} x ${l.orderLine.description}`).join("; ")}</p>
                    <p className="flex flex-wrap gap-4 text-callout">
                      <a href={`${base}/note`} className="text-link underline underline-offset-4">
                        Delivery note (PDF)
                      </a>
                      {d.podFilename ? (
                        <a href={`${base}/pod`} className="text-link underline underline-offset-4">
                          Proof of delivery
                        </a>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2">No deliveries yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
