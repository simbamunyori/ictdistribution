import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { WARRANTY_STATE_LABEL, WARRANTY_STATE_TONE, warrantyState } from "@/lib/warranty";
import { formatDate } from "@/lib/zoned";
import { findUnits, UNIT_STATUS_LABEL, UNIT_STATUS_TONE } from "@/server/aftersales/units";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { RETURN_STAFF_LABEL } from "@/server/portal/returns";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Warranty" };

/** Look up any serial number we have sold: whose it is, its warranty and its returns. */
export default async function WarrantyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = (await searchParams).q ?? "";
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewOrders")) redirect("/admin");
  const units = await findUnits(prisma, q);
  const now = new Date();
  return (
    <>
      <PageHeader title="Warranty" lead="Find a serial number however it is written, to see who has it, its warranty and its returns. Serials are recorded on each order." />
      <Card>
        <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end" role="search">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="q" className="font-semibold text-ink">
              Serial number
            </label>
            <input id="q" name="q" defaultValue={q} className={inputClass} />
          </div>
          <Button type="submit" variant="secondary">
            Find
          </Button>
        </form>
        {units.length ? (
          <TableWrap label={q ? "Matching serial numbers" : "Newest serial numbers"}>
            <table className="mt-4 w-full min-w-[46rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Serial number</th>
                  <th className={th}>Item</th>
                  <th className={th}>Customer and order</th>
                  <th className={th}>Warranty</th>
                  <th className={th}>Returns</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const w = warrantyState(u, now);
                  return (
                    <tr key={u.id}>
                      <td className={`${td} font-mono`}>
                        {u.serial}
                        {u.replaces ? <span className="block font-sans text-ink-muted">Replaces {u.replaces.serial}</span> : null}
                      </td>
                      <td className={td}>
                        {u.description}
                        {u.mpn ? <span className="block text-ink-muted">Part {u.mpn}</span> : null}
                      </td>
                      <td className={td}>
                        {u.order.organisation?.name ?? u.order.name}
                        <Link href={`/admin/orders/${u.orderId}`} className="block text-link underline underline-offset-4">
                          {u.order.number}
                        </Link>
                      </td>
                      <td className={td}>
                        <Badge tone={WARRANTY_STATE_TONE[w]}>{WARRANTY_STATE_LABEL[w]}</Badge>
                        {u.endsAt ? <span className="block text-ink-muted">{w === "ENDED" ? "Ended" : "Until"} {formatDate(u.endsAt, u.order.market.locale, u.order.market.timeZone)}</span> : null}
                        {u.status !== "WITH_CUSTOMER" ? (
                          <span className="mt-1 block">
                            <Badge tone={UNIT_STATUS_TONE[u.status]}>{UNIT_STATUS_LABEL[u.status]}</Badge>
                          </span>
                        ) : null}
                        {u.replacedBy ? <span className="block text-ink-muted">By {u.replacedBy.serial}</span> : null}
                      </td>
                      <td className={td}>
                        {u.returnUnits.length
                          ? u.returnUnits.map(({ returnLine: { request: r } }) => (
                              <Link key={r.id} href={`/admin/returns/${r.id}`} className="block text-link underline underline-offset-4">
                                {r.number}, {RETURN_STAFF_LABEL[r.status].toLowerCase()}
                              </Link>
                            ))
                          : "None"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="mt-4">{q ? "No serial number matches. Check for a letter O typed as a zero." : "No serial numbers recorded yet."}</p>
        )}
      </Card>
    </>
  );
}
