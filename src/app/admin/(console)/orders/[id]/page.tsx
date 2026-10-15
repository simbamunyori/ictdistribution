import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cancelDeliveryAction, deliveredAction, dispatchDeliveryAction, lineTrackingAction, prepareDeliveryAction } from "@/app/admin/(console)/logistics-actions";
import { CancelOrderForm, FulfilForm, PaymentForm } from "@/components/admin/shop-forms";
import { SpecForm } from "@/components/admin/spec-form";
import { OrderView } from "@/components/shop/order-view";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { TRACKING_LABEL, TRACKING_ORDER } from "@/lib/freight";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DELIVERY_STATUS_LABEL, linesToDeliver } from "@/server/logistics/deliveries";
import { orderLogistics } from "@/server/logistics/tracking";
import { RETURN_REASON_LABEL, RETURN_STAFF_LABEL, RETURN_STATUS_TONE } from "@/server/portal/returns";
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
      invoice: { select: { number: true } },
      returns: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, reason: true, createdAt: true } },
    },
  });
  if (!order) notFound();
  const canDeliver = staffCan(role, "manageDeliveries");
  const [logistics, toDeliver] = await Promise.all([orderLogistics(prisma, order.id), linesToDeliver(prisma, order.id)]);
  const packable = (TO_SEND.includes(order.status) || order.status === "FULFILLED") && toDeliver.some((l) => l.toDeliver > 0);
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

        <OrderView order={order} staff proFormaHref={`/admin/orders/${order.id}/pro-forma`} invoice={order.invoice ? { number: order.invoice.number, href: `/admin/orders/${order.id}/invoice` } : undefined} logistics={logistics} links={{ note: (n) => `/admin/deliveries/${encodeURIComponent(n)}/note`, pod: (n) => `/admin/deliveries/${encodeURIComponent(n)}/pod`, commercialInvoice: order.fulfilment === "DELIVERY" ? `/admin/orders/${order.id}/commercial-invoice` : undefined }} />

        {canDeliver && order.status !== "CANCELLED" && order.status !== "AWAITING_PAYMENT" ? (
          <Card>
            <h2 className="text-headline font-bold">Deliveries</h2>
            {logistics.deliveries.filter((d) => d.status !== "DELIVERED").map((d) => (
              <div key={d.id} className="mt-4 rounded-md border border-line p-4">
                <p className="mb-3 text-callout">
                  <a href={`/admin/deliveries/${encodeURIComponent(d.number)}/note`} className="font-semibold text-link underline underline-offset-4">
                    {d.number}
                  </a>{" "}
                  {DELIVERY_STATUS_LABEL[d.status]}, {d.lines.reduce((n, l) => n + l.quantity, 0)} items. Print its delivery note and pack it with the goods.
                </p>
                {d.status === "PREPARED" ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <ActionForm action={dispatchDeliveryAction} hidden={{ deliveryId: d.id, orderId: order.id }} label="Dispatch" size="md" variant="primary" confirm={`Dispatch ${d.number}? Its goods come out of stock and the customer can see it has left.`}>
                      <label className="flex flex-col gap-1">
                        <span className="text-caption font-semibold">Carrier</span>
                        <input name="carrier" defaultValue={d.carrier} className={cn(inputClass, "w-40")} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-caption font-semibold">Tracking number</span>
                        <input name="reference" defaultValue={d.reference} className={cn(inputClass, "w-40")} />
                      </label>
                    </ActionForm>
                    <ActionForm action={cancelDeliveryAction} hidden={{ deliveryId: d.id, orderId: order.id }} label="Unpack" size="md" />
                  </div>
                ) : (
                  <SpecForm action={deliveredAction} idPrefix={`d${d.id}-`} hidden={{ deliveryId: d.id, orderId: order.id }} fields={[{ kind: "text", id: "receivedBy", label: "Signed for by" }, { kind: "file", id: "pod", label: "Signed note or photo (optional)", accept: "application/pdf,image/png,image/jpeg", hint: "PDF, PNG or JPEG, up to 10 MB." }]} submitLabel="Mark delivered" variant="secondary" />
                )}
              </div>
            ))}
            {packable ? (
              <div className="mt-4">
                <h3 className="mb-1 font-bold">Pack a delivery</h3>
                <p className="mb-4 text-callout text-ink-muted">Choose how many of each line go in this box or trip. Send the rest later in another delivery.</p>
                <SpecForm
                  action={prepareDeliveryAction}
                  idPrefix="pack-"
                  hidden={{ orderId: order.id }}
                  fields={[
                    ...toDeliver.filter((l) => l.toDeliver > 0).map((l) => ({ kind: "text" as const, id: `qty-${l.id}`, label: `${l.description} (up to ${l.toDeliver})`, inputMode: "numeric" as const, defaultValue: String(l.toDeliver), hint: l.tracking ? TRACKING_LABEL[l.tracking] : "Not ordered yet", wide: true })),
                    { kind: "text", id: "carrier", label: "Carrier (optional)" },
                    { kind: "text", id: "reference", label: "Tracking number (optional)" },
                  ]}
                  submitLabel="Pack delivery"
                  pendingLabel="Packing"
                />
              </div>
            ) : !logistics.deliveries.some((d) => d.status !== "DELIVERED") ? (
              <p className="mt-2 text-callout text-ink-muted">{logistics.deliveries.length ? "Everything has been delivered." : "Nothing to pack."}</p>
            ) : null}
          </Card>
        ) : null}

        {canDeliver && order.status !== "CANCELLED" && order.procuredAt ? (
          <Card>
            <h2 className="text-headline font-bold">Set a line&apos;s step by hand</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">When something happened outside the system, such as a courier delivering it. The customer sees the step, not the note.</p>
            <SpecForm
              action={lineTrackingAction}
              idPrefix="track-"
              hidden={{ orderId: order.id }}
              columns={3}
              fields={[
                { kind: "select", id: "lineId", label: "Line", options: order.lines.map((l) => ({ value: l.id, label: l.description })) },
                { kind: "select", id: "status", label: "Step", options: TRACKING_ORDER.map((t) => ({ value: t, label: TRACKING_LABEL[t] })) },
                { kind: "text", id: "note", label: "Note (optional)" },
              ]}
              submitLabel="Set step"
              variant="secondary"
            />
          </Card>
        ) : null}

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
                    {p.dropShip ? <Badge tone="highlight">Straight to the customer</Badge> : null}
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

        {order.returns.length ? (
          <Card>
            <h2 className="text-headline font-bold">Returns</h2>
            <ul className="mt-3 divide-y divide-line">
              {order.returns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span>
                    <Link href={`/admin/returns/${r.id}`} className="font-semibold text-link underline underline-offset-4">
                      {r.number}
                    </Link>
                    <span className="text-callout text-ink-muted">, {RETURN_REASON_LABEL[r.reason].toLowerCase()}, {formatDate(r.createdAt, locale, timeZone)}</span>
                  </span>
                  <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STAFF_LABEL[r.status]}</Badge>
                </li>
              ))}
            </ul>
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
