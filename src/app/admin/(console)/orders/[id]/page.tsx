import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CancelOrderForm, FulfilForm, PaymentForm } from "@/components/admin/shop-forms";
import { OrderView } from "@/components/shop/order-view";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { pricingSettings } from "@/server/pricing/rates";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "@/server/procurement/common";
import { ORDER_STATUS_LABEL, TO_SEND } from "@/server/shop/orders";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Order" };

const TONE = { AWAITING_PAYMENT: "warning", PAID: "highlight", ON_ACCOUNT: "highlight", FULFILLED: "positive", CANCELLED: "neutral" } as const;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewOrders")) redirect("/admin");
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { poLines: { where: { purchaseOrder: { status: { not: "CANCELLED" } } }, select: { id: true } } } },
      payments: { orderBy: { receivedOn: "asc" } },
      market: true,
      organisation: { select: { id: true, name: true } },
      quote: { select: { id: true, number: true } },
      purchaseOrders: { orderBy: { createdAt: "asc" }, include: { supplier: { select: { name: true } } } },
    },
  });
  if (!order) notFound();
  const { locale, timeZone } = order.market;
  const money = (amountMinor: bigint, currency = order.currency) => formatMoney({ amountMinor, currency }, locale);
  const paid = order.payments.reduce((s, p) => s + p.amountMinor, 0n);
  const owing = order.totalMinor - paid > 0n ? order.totalMinor - paid : 0n;
  const showCost = staffCan(role, "viewSuppliers");
  const base = showCost ? (await pricingSettings(prisma)).baseCurrency : "";
  const cost = order.lines.reduce((s, l) => (l.unitCostBaseMinor === null ? s : s + l.unitCostBaseMinor * BigInt(l.quantity)), 0n);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const open = order.status === "AWAITING_PAYMENT" || TO_SEND.includes(order.status);
  // Lines no live purchase order covers, once purchase orders were made.
  const unbought = order.procuredAt ? order.lines.filter((l) => !l.poLines.length) : [];
  // On account, money can arrive before or after it is sent.
  const takesPayment = order.status === "AWAITING_PAYMENT" || (order.paymentMethod === "ACCOUNT" && order.status !== "CANCELLED" && order.paidAt === null);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/orders" className="text-link underline underline-offset-4">
          Orders
        </Link>
      </p>
      <PageHeader
        title={`Order ${order.number}`}
        lead={
          <>
            <Badge tone={TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge> Placed {formatDateTime(order.createdAt, locale, timeZone)} in {order.market.name}
            {order.organisation ? (
              <>
                , for{" "}
                <Link href={`/admin/customers/${order.organisation.id}`} className="text-link underline underline-offset-4">
                  {order.organisation.name}
                </Link>
              </>
            ) : order.userId ? (
              ", by a signed-in customer"
            ) : (
              ", as a guest"
            )}
            {order.customerReference ? `, their reference ${order.customerReference}` : ""}
            {order.quote ? (
              <>
                , from quote{" "}
                <Link href={`/admin/quotes/${order.quote.id}`} className="text-link underline underline-offset-4">
                  {order.quote.number}
                </Link>
              </>
            ) : null}
            .
          </>
        }
      />
      <div className="flex max-w-4xl flex-col gap-6">
        {takesPayment && staffCan(role, "recordPayments") ? (
          <Card>
            <h2 className="mb-1 text-headline font-bold">Record a payment</h2>
            <p className="mb-4 text-callout text-ink-muted">
              {money(owing)} to pay{order.payBy ? ` by ${formatDate(order.payBy, locale, timeZone)}` : ""}, with reference {order.number}.{" "}
              {order.paymentMethod === "ACCOUNT" ? "It is on account, so it can be sent before it is paid." : "The order is marked paid and the customer told once payments cover the total."}
            </p>
            <PaymentForm orderId={order.id} currency={order.currency} owing={toPlainAmount({ amountMinor: owing, currency: order.currency })} today={today} />
          </Card>
        ) : null}
        {TO_SEND.includes(order.status) && staffCan(role, "fulfilOrders") ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">{order.fulfilment === "COLLECTION" ? "Ready to collect" : "Send it"}</h2>
            <FulfilForm orderId={order.id} collection={order.fulfilment === "COLLECTION"} />
          </Card>
        ) : null}

        <OrderView order={order} staff proFormaHref={`/admin/orders/${order.id}/pro-forma`} />

        {staffCan(role, "viewPurchaseOrders") && order.procuredAt ? (
          <Card>
            <h2 className="text-headline font-bold">Purchase orders</h2>
            {order.purchaseOrders.length ? (
              <ul className="mt-3 flex flex-col gap-2 text-callout">
                {order.purchaseOrders.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/purchase-orders/${p.id}`} className="font-semibold text-link underline underline-offset-4">
                      {p.number}
                    </Link>
                    <span>
                      to {p.supplier.name}, {formatMoney({ amountMinor: p.totalMinor, currency: p.currency }, locale)}
                    </span>
                    <Badge tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            {unbought.length ? (
              <Alert tone="warning" className="mt-3">
                No supplier for {unbought.map((l) => l.description).join(", ")}. Buy {unbought.length === 1 ? "it" : "them"} by hand, or add a supplier offer and make a purchase order.
              </Alert>
            ) : null}
          </Card>
        ) : null}

        {order.payments.length ? (
          <Card>
            <h2 className="text-headline font-bold">Payments received</h2>
            <TableWrap label="Payments">
              <table className="mt-3 w-full min-w-[32rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Arrived</th>
                    <th className={th}>Reference</th>
                    <th className={th}>Recorded by</th>
                    <th className={cn(th, "text-right")}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id}>
                      <td className={td}>{formatDate(p.receivedOn, locale, "UTC")}</td>
                      <td className={td}>{p.reference || "None"}</td>
                      <td className={td}>{p.recordedByLabel}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{money(p.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        ) : null}

        {showCost ? (
          <Card>
            <h2 className="text-headline font-bold">Cost, staff only</h2>
            <p className="mt-1 text-callout text-ink-muted">
              Landed cost when the order was placed: {money(cost, base)} for the items. Never shown to customers.
            </p>
          </Card>
        ) : null}

        {open && staffCan(role, "cancelOrders") ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Cancel the order</h2>
            <CancelOrderForm orderId={order.id} paid={paid > 0n} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
