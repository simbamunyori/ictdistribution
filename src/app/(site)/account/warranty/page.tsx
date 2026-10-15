import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { WARRANTY_STATE_LABEL, WARRANTY_STATE_TONE, warrantyState } from "@/lib/warranty";
import { formatDate } from "@/lib/zoned";
import { customerUnits, UNIT_STATUS_LABEL } from "@/server/aftersales/units";
import { prisma } from "@/server/db";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Warranty" };

export default async function WarrantyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = (await searchParams).q ?? "";
  const v = await portalViewer("/account/warranty");
  const units = await customerUnits(prisma, v, q);
  const now = new Date();
  const canAsk = portalCan(v, "buy");
  return (
    <>
      <PageHeader title="Serial numbers and warranty" lead="Every serial-numbered item we have sent you, with how long its warranty runs. Ask for a repair or replacement from here." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end" role="search">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="q" className="font-semibold text-ink">
                Find a serial number, product or order
              </label>
              <input id="q" name="q" defaultValue={q} className={inputClass} />
            </div>
            <Button type="submit" variant="secondary">
              Find
            </Button>
          </form>
          {units.length ? (
            <TableWrap label="Serial-numbered items">
              <table className="mt-4 w-full min-w-[40rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Serial number</th>
                    <th className={th}>Order</th>
                    <th className={th}>Warranty</th>
                    <th className={th}>
                      <span className="sr-only">Repair</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const { locale, timeZone } = u.order.market;
                    const w = warrantyState(u, now);
                    const open = u.returnUnits.find((x) => ["REQUESTED", "APPROVED", "RECEIVED", "IN_REPAIR"].includes(x.returnLine.request.status))?.returnLine.request;
                    return (
                      <tr key={u.id}>
                        <td className={td}>
                          {u.description}
                          {u.mpn ? <span className="block text-ink-muted">Part {u.mpn}</span> : null}
                          {u.warrantyTerms ? <span className="block text-ink-muted">{u.warrantyTerms}</span> : null}
                        </td>
                        <td className={`${td} font-mono`}>
                          {u.serial}
                          {u.replaces ? <span className="block font-sans text-ink-muted">Replaces {u.replaces.serial}</span> : null}
                        </td>
                        <td className={td}>
                          <Link href={`/orders/${encodeURIComponent(u.order.number)}`} className="text-link underline underline-offset-4">
                            {u.order.number}
                          </Link>
                        </td>
                        <td className={td}>
                          {u.status === "WITH_CUSTOMER" ? <Badge tone={WARRANTY_STATE_TONE[w]}>{WARRANTY_STATE_LABEL[w]}</Badge> : <Badge tone="neutral">{UNIT_STATUS_LABEL[u.status]}</Badge>}
                          {u.status === "WITH_CUSTOMER" && w === "IN_WARRANTY" && u.endsAt ? <span className="block text-ink-muted">Until {formatDate(u.endsAt, locale, timeZone)}</span> : null}
                          {u.status === "WITH_CUSTOMER" && w === "ENDED" && u.endsAt ? <span className="block text-ink-muted">Ended {formatDate(u.endsAt, locale, timeZone)}</span> : null}
                          {u.replacedBy ? <span className="block text-ink-muted">By {u.replacedBy.serial}</span> : null}
                        </td>
                        <td className={td}>
                          {open ? (
                            <Link href={`/account/returns/${encodeURIComponent(open.number)}`} className="text-link underline underline-offset-4">
                              Return {open.number}
                            </Link>
                          ) : canAsk && u.status === "WITH_CUSTOMER" && u.startsAt ? (
                            <Link href={`/account/returns/new?order=${encodeURIComponent(u.order.number)}&unit=${encodeURIComponent(u.id)}`} className="font-semibold text-link underline underline-offset-4">
                              Ask for a repair<span className="sr-only"> of {u.serial}</span>
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-4">{q ? "Nothing matches. Check the serial number on the item's label." : "No serial-numbered items yet. They appear here once they have left us."}</p>
          )}
          <p className="mt-4 text-callout text-ink-muted">Items without a serial number carry the warranty shown on their product page, from the day they left us.</p>
        </Card>
      </div>
    </>
  );
}
