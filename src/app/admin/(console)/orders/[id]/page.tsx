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
import { recordRefundAction, setSerialsAction } from "@/app/admin/(console)/aftersales-actions";
import { orderMoney } from "@/server/aftersales/credit-notes";
import { UNIT_STATUS_LABEL } from "@/server/aftersales/units";
import { WARRANTY_STATE_LABEL, warrantyState } from "@/lib/warranty";

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
      units: { orderBy: { serial: "asc" }, select: { id: true, serial: true, orderLineId: true, source: true, status: true, startsAt: true, endsAt: true, warrantyMonths: true } },
      creditNotes: { orderBy: { issuedAt: "asc" }, include: { request: { select: { id: true, number: true } } } },
      refunds: { orderBy: { paidOn: "asc" } },
    },
  });
  if (!order) notFound();
  const canDeliver = staffCan(role, "manageDeliveries");
  const [logistics, toDeliver] = await Promise.all([orderLogistics(prisma, order.id), linesToDeliver(prisma, order.id)]);
  const packable = (TO_SEND.includes(order.status) || order.status === "FULFILLED") && toDeliver.some((l) => l.toDeliver > 0);
  const { locale, timeZone } = order.market;
  const money = (amountMinor: bigint, currency = order.currency) => formatMoney({ amountMinor, currency }, locale);
  const m = orderMoney(order.totalMinor, order.payments, order.creditNotes, order.refunds);
  const owing = m.outstanding;
  const now = new Date();
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

        {order.status !== "CANCELLED" && order.lines.length && (staffCan(role, "recordSerials") || order.units.length) ? (
          <Card>
            <h2 className="text-headline font-bold">Serial numbers and warranty</h2>
            <p className="mt-1 text-callout text-ink-muted">Serials from a supplier&apos;s shipping notice appear by themselves. Type the rest, one per line. Each unit&apos;s warranty starts the day it leaves us.</p>
            <div className="mt-4 flex flex-col gap-6">
              {order.lines.map((l) => {
                const units = order.units.filter((u) => u.orderLineId === l.id);
                const fromSupplier = units.filter((u) => u.source === "supplier");
                return (
                  <div key={l.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                    <p className="font-semibold">
                      {l.quantity} x {l.description}
                    </p>
                    {units.length ? (
                      <ul className="mt-1 mb-3 text-callout">
                        {units.map((u) => {
                          const w = warrantyState(u, now);
                          return (
                            <li key={u.id}>
                              <span className="font-mono">{u.serial}</span>
                              <span className="text-ink-muted">
                                {u.source === "supplier" ? ", from the supplier" : u.source === "replacement" ? ", a replacement" : ""}, {u.status !== "WITH_CUSTOMER" ? UNIT_STATUS_LABEL[u.status].toLowerCase() : w === "IN_WARRANTY" && u.endsAt ? `warranty until ${formatDate(u.endsAt, locale, timeZone)}` : WARRANTY_STATE_LABEL[w].toLowerCase()}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {staffCan(role, "recordSerials") ? <SpecForm action={setSerialsAction} hidden={{ lineId: l.id, orderId: order.id }} idPrefix={`serials-${l.id}-`} columns={1} fields={[{ kind: "textarea", id: "serials", label: `Serial numbers typed for ${l.description}`, defaultValue: l.serials, rows: Math.min(6, Math.max(2, l.quantity)), hint: fromSupplier.length ? `${fromSupplier.length} more from the supplier.` : undefined }]} submitLabel="Save serial numbers" pendingLabel="Saving" variant="secondary" /> : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        {order.creditNotes.length || order.refunds.length ? (
          <Card>
            <h2 className="text-headline font-bold">Credit notes and refunds</h2>
            <ul className="mt-3 flex flex-col gap-1 text-callout">
              {order.creditNotes.map((c) => (
                <li key={c.id}>
                  <a href={`/admin/credit-notes/${encodeURIComponent(c.number)}`} className="font-semibold text-link underline underline-offset-4">
                    {c.number}
                  </a>
                  , {money(c.totalMinor)} credited {formatDate(c.issuedAt, locale, timeZone)} by {c.issuedByLabel}
                  {c.request ? (
                    <>
                      {" "}
                      for return{" "}
                      <Link href={`/admin/returns/${c.request.id}`} className="text-link underline underline-offset-4">
                        {c.request.number}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
              {order.refunds.map((r) => (
                <li key={r.id}>
                  Refund of {money(r.amountMinor)} paid {formatDate(r.paidOn, locale, "UTC")}
                  {r.reference ? `, ${r.reference}` : ""}, recorded by {r.recordedByLabel}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-callout">{m.overpaid ? `We owe the customer ${money(m.overpaid)}.` : m.outstanding ? `${money(m.outstanding)} still to pay after credits.` : "Nothing owed either way."}</p>
            {m.overpaid && staffCan(role, "issueCreditNotes") ? (
              <div className="mt-4">
                <SpecForm action={recordRefundAction} hidden={{ orderId: order.id }} idPrefix="refund-" columns={3} fields={[{ kind: "text", id: "amount", label: `Paid back (${order.currency})`, inputMode: "decimal", defaultValue: toPlainAmount({ amountMinor: m.overpaid, currency: order.currency }) }, { kind: "text", id: "paidOn", label: "Paid on", type: "date", defaultValue: today }, { kind: "text", id: "reference", label: "Reference" }]} submitLabel="Record refund" pendingLabel="Saving" />
              </div>
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
            <CancelOrderForm orderId={order.id} paid={m.paid > 0n} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
