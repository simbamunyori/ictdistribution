import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE, listDeliveries } from "@/server/logistics/deliveries";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Deliveries" };

const STATUSES = Object.keys(DELIVERY_STATUS_LABEL) as (keyof typeof DELIVERY_STATUS_LABEL)[];

export default async function Deliveries({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewLogistics")) redirect("/admin");
  const status = STATUSES.includes(q.status as (typeof STATUSES)[number]) ? (q.status as (typeof STATUSES)[number]) : undefined;
  const deliveries = await listDeliveries(prisma, { status, q: q.q });
  return (
    <>
      <PageHeader title="Deliveries" lead="What has left, or is being packed, for customers. Pack a delivery from its order's page." />
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Delivery, waybill, order or customer" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {DELIVERY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        {deliveries.length ? (
          <TableWrap label="Deliveries">
            <table className="w-full min-w-[44rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Delivery</th>
                  <th className={th}>Order</th>
                  <th className={th}>Carrier</th>
                  <th className={th}>Packed</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className={td}>
                      <a href={`/admin/deliveries/${encodeURIComponent(d.number)}/note`} className="font-semibold text-link underline underline-offset-4">
                        {d.number}
                      </a>
                      <span className="block text-caption text-ink-muted">
                        {d._count.lines} {d._count.lines === 1 ? "line" : "lines"}
                        {d.podFilename ? ", proof attached" : ""}
                      </span>
                    </td>
                    <td className={td}>
                      <Link href={`/admin/orders/${d.order.id}`} className="text-link underline underline-offset-4">
                        {d.order.number}
                      </Link>
                      <span className="block text-caption text-ink-muted">{d.order.name}</span>
                    </td>
                    <td className={td}>{[d.carrier, d.reference].filter(Boolean).join(", ") || "Not given"}</td>
                    <td className={td}>{staffWhen(d.createdAt)}</td>
                    <td className={td}>
                      <Badge tone={DELIVERY_STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>
                      {d.status === "DELIVERED" && d.receivedBy ? <span className="block text-caption text-ink-muted">Signed by {d.receivedBy}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No deliveries match.</p>
        )}
      </Card>
    </>
  );
}
