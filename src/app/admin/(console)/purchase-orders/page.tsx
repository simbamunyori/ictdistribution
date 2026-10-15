import type { PurchaseOrderStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { company } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "@/server/procurement/common";
import { listPurchaseOrders, purchaseOrdersWaiting } from "@/server/procurement/purchase-orders";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Purchase orders" };

const STATUSES = Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[];

export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewPurchaseOrders")) redirect("/admin");
  const status = STATUSES.includes(q.status as PurchaseOrderStatus) ? (q.status as PurchaseOrderStatus) : undefined;
  const [pos, waiting] = await Promise.all([listPurchaseOrders(prisma, { status, q: q.q }), purchaseOrdersWaiting(prisma)]);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        lead="One per supplier for each paid or on-account order. Those inside the rules go to the supplier by themselves; the rest wait here for approval."
        actions={
          <Link href="/admin/purchase-orders/rules" className="font-semibold text-link underline underline-offset-4">
            Rules
          </Link>
        }
      />
      {waiting.approve || waiting.byHand ? (
        <p className="mb-6 flex flex-wrap gap-3">
          {waiting.approve ? (
            <Link href="/admin/purchase-orders?status=AWAITING_APPROVAL" className="rounded-md border border-line bg-raised px-3 py-2 font-semibold hover:border-brand">
              {waiting.approve} to approve
            </Link>
          ) : null}
          {waiting.byHand ? (
            <Link href="/admin/purchase-orders?status=TO_SEND_BY_HAND" className="rounded-md border border-line bg-raised px-3 py-2 font-semibold hover:border-brand">
              {waiting.byHand} to send on WhatsApp
            </Link>
          ) : null}
        </p>
      ) : null}
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Purchase order, order, supplier or their reference" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PO_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        {pos.length ? (
          <TableWrap label="Purchase orders">
            <table className="w-full min-w-[48rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Purchase order</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>For order</th>
                  <th className={th}>Made</th>
                  <th className={cn(th, "text-right")}>Total</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>
                      <Link href={`/admin/purchase-orders/${p.id}`} className="font-semibold text-link underline underline-offset-4">
                        {p.number}
                      </Link>
                      <span className="block text-caption text-ink-muted">
                        {p._count.lines} {p._count.lines === 1 ? "line" : "lines"}
                        {p._count.documents ? `, ${p._count.documents} ${p._count.documents === 1 ? "file" : "files"}` : ""}
                      </span>
                    </td>
                    <td className={td}>
                      {p.supplier.name}
                      {p.supplierReference ? <span className="block text-caption text-ink-muted">Their reference {p.supplierReference}</span> : null}
                    </td>
                    <td className={td}>
                      <Link href={`/admin/orders/${p.order.id}`} className="text-link underline underline-offset-4">
                        {p.order.number}
                      </Link>
                    </td>
                    <td className={td}>{staffWhen(p.createdAt)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatMoney({ amountMinor: p.totalMinor, currency: p.currency }, company.staffLocale)}</td>
                    <td className={td}>
                      <Badge tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No purchase orders match.</p>
        )}
      </Card>
    </>
  );
}
