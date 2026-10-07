import type { OrderStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listOrders, ORDER_STATUS_LABEL } from "@/server/shop/orders";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Orders" };

const STATUSES: OrderStatus[] = ["AWAITING_PAYMENT", "PAID", "FULFILLED", "CANCELLED"];
const ORDER_TONE = { AWAITING_PAYMENT: "warning", PAID: "highlight", FULFILLED: "positive", CANCELLED: "neutral" } as const;

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewOrders")) redirect("/admin");
  const status = STATUSES.includes(q.status as OrderStatus) ? (q.status as OrderStatus) : undefined;
  const orders = await listOrders(prisma, { status, q: q.q });
  return (
    <>
      <PageHeader title="Orders" lead="Shop orders. Record bank transfers as they arrive; paid orders are then sent or made ready to collect." />
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Order number, name or email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        {orders.length ? (
          <TableWrap label="Orders">
            <table className="w-full min-w-[44rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Order</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Placed</th>
                  <th className={cn(th, "text-right")}>Total</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className={td}>
                      <Link href={`/admin/orders/${o.id}`} className="font-semibold text-link underline underline-offset-4">
                        {o.number}
                      </Link>
                      <span className="block text-caption text-ink-muted">{o.market.name}, {o.fulfilment === "DELIVERY" ? "delivery" : "collection"}</span>
                    </td>
                    <td className={td}>
                      {o.name}
                      <span className="block text-caption text-ink-muted">{o.email}</span>
                    </td>
                    <td className={td}>{formatDateTime(o.createdAt, o.market.locale, o.market.timeZone)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatMoney({ amountMinor: o.totalMinor, currency: o.currency }, o.market.locale)}</td>
                    <td className={td}>
                      <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No orders match.</p>
        )}
      </Card>
    </>
  );
}
