import type { Prisma, PrismaClient } from "@prisma/client";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { invoiceState } from "@/lib/statement";
import { formatDate } from "@/lib/zoned";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { sheet } from "@/server/documents/pdf-kit";
import { queueEmail } from "@/server/email/outbox";
import { PAYMENT_LABEL } from "@/server/shop/orders";
import { orderMoney } from "@/server/aftersales/credit-notes";
import { inScope, scopeWhere, type PortalViewer } from "./scope";

/**
 * Tax invoices. Each order gets one, numbered INV-100001 onwards, when it
 * is sent or made ready to collect. The customer is emailed a link that
 * opens it without signing in, and finds it in their account. What it
 * charges is the order's lines and total; payments recorded against the
 * order settle it.
 */

export const INVOICE_INCLUDE = {
  order: { include: { lines: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { receivedOn: "asc" } }, refunds: { orderBy: { paidOn: "asc" } }, market: true } },
  creditNotes: { orderBy: { issuedAt: "asc" } },
} satisfies Prisma.InvoiceInclude;

export type FullInvoice = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/** Who the invoice is made out to, as it is today. */
function billToFor(o: { name: string; email: string; addressLine1: string; addressLine2: string; city: string; postalCode: string }, org: { name: string; address: string } | null): string {
  const address = org?.address.trim() || [o.addressLine1, o.addressLine2, o.city, o.postalCode].filter(Boolean).join(", ");
  return (org ? [org.name, `Attention: ${o.name}`, address, o.email] : [o.name, address, o.email]).filter(Boolean).join("\n");
}

/**
 * Inside the transaction that sends the order or makes it ready: issues
 * its invoice, once, and queues the email with its link. Returns the
 * invoice number.
 */
export async function issueInvoice(tx: Prisma.TransactionClient, key: string, orderId: string, now: Date): Promise<string> {
  const existing = await tx.invoice.findUnique({ where: { orderId }, select: { number: true } });
  if (existing) return existing.number;
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { organisation: true, market: true, payments: true } });
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
  const token = newToken();
  const dueAt = o.paymentMethod === "ACCOUNT" && o.payBy ? o.payBy : now;
  const inv = await tx.invoice.create({
    data: {
      number: `INV-${n}`,
      orderId,
      userId: o.userId,
      organisationId: o.organisationId,
      currency: o.currency,
      totalMinor: o.totalMinor,
      taxMinor: o.taxMinor,
      billTo: billToFor(o, o.organisation),
      taxNumber: o.organisation?.taxNumber ?? "",
      issuedAt: now,
      dueAt,
      accessTokenHash: hashToken(token),
    },
  });
  const paid = o.payments.reduce((s, p) => s + p.amountMinor, 0n);
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency: o.currency }, o.market.locale);
  await queueEmail(tx, key, {
    to: o.email,
    kind: "invoice.issued",
    payload: { number: inv.number, order: o.number, name: o.name, total: money(o.totalMinor), due: formatDate(dueAt, o.market.locale, o.market.timeZone), balance: paid >= o.totalMinor ? "" : money(o.totalMinor - paid), bankDetails: o.bankDetails },
    secret: { token },
  });
  await audit(tx, { ...SYSTEM_ACTOR, action: "invoice.issued", summary: `Invoice ${inv.number} issued for order ${o.number}, ${money(o.totalMinor)}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Invoice", targetId: inv.id, visibleToCustomer: Boolean(o.userId || o.organisationId) });
  return inv.number;
}

// ─── Reading ─────────────────────────────────────────────────────────

/** The invoice for the link in its email, or in a reminder about it. */
export async function invoiceByToken(db: Pick<PrismaClient, "invoice" | "invoiceReminder">, number: string, token: string): Promise<FullInvoice | null> {
  if (!token) return null;
  const hash = hashToken(token);
  const inv = await db.invoice.findUnique({ where: { number }, include: INVOICE_INCLUDE });
  if (!inv) return null;
  if (inv.accessTokenHash === hash) return inv;
  const reminder = await db.invoiceReminder.findUnique({ where: { accessTokenHash: hash }, select: { invoiceId: true } });
  return reminder?.invoiceId === inv.id ? inv : null;
}

export async function invoiceForViewer(db: Pick<PrismaClient, "invoice">, number: string, v: Pick<PortalViewer, "userId" | "organisationId">): Promise<FullInvoice | null> {
  const inv = await db.invoice.findUnique({ where: { number }, include: INVOICE_INCLUDE });
  return inv && inScope(v, inv) ? inv : null;
}


/** The viewer's invoices, newest first, with what is paid and still owed on each. */
export async function customerInvoices(db: Pick<PrismaClient, "invoice">, v: Pick<PortalViewer, "userId" | "organisationId">, now = new Date(), filter: { open?: boolean } = {}) {
  const rows = await db.invoice.findMany({
    where: scopeWhere(v),
    orderBy: { issuedAt: "desc" },
    take: 500,
    include: { order: { select: { number: true, customerReference: true, userId: true, payments: { select: { amountMinor: true } }, refunds: { select: { amountMinor: true } }, market: { select: { locale: true, timeZone: true } } } }, creditNotes: { select: { number: true, totalMinor: true } } },
  });
  const all = rows.map((r) => {
    const m = orderMoney(r.totalMinor, r.order.payments, r.creditNotes, r.order.refunds);
    return { ...r, paid: m.settled, credited: m.credited, outstanding: m.outstanding, state: invoiceState(m.due, m.settled, r.dueAt, now) };
  });
  return filter.open ? all.filter((r) => r.state !== "PAID") : all;
}

// ─── The PDF ─────────────────────────────────────────────────────────

/** The tax invoice as a PDF. Shop orders show prices with tax; orders from quotes show them before tax, as quoted. */
export async function invoicePdf(inv: FullInvoice, ctx: { appUrl: string; legalName: string; now?: Date }): Promise<Uint8Array> {
  const o = inv.order;
  const { locale, timeZone } = o.market;
  const s = await sheet("Tax invoice", inv.number);
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: inv.currency }, locale);
  const date = (d: Date) => formatDate(d, locale, timeZone);
  const m = orderMoney(inv.totalMinor, o.payments, inv.creditNotes, o.refunds);
  const state = invoiceState(m.due, m.settled, inv.dueAt, ctx.now ?? new Date());
  s.heading([ctx.legalName, o.market.taxNumber ? `${o.taxName} number ${o.market.taxNumber}` : "", company.domain, o.market.supportEmail ?? ""], [`Date: ${date(inv.issuedAt)}`, `Due: ${date(inv.dueAt)}`, `Order: ${o.number}`, `Payment: ${PAYMENT_LABEL[o.paymentMethod]}`]);
  const [first, ...rest] = inv.billTo.split("\n");
  s.party("Bill to", first ?? "", [rest.join(", "), [inv.taxNumber ? `Tax number ${inv.taxNumber}` : "", o.customerReference ? `Your reference: ${o.customerReference}` : ""].filter(Boolean).join(". "), o.pricesIncludeTax ? `Prices in ${inv.currency}, including ${o.taxName}.` : `Prices in ${inv.currency}, per unit before ${o.taxName}.`]);
  s.lines(o.lines.map((l, i) => ({ n: String(i + 1), description: l.description, sub: [l.mpn ? `Part ${l.mpn}` : "", l.specialName ?? ""].filter(Boolean).join(", "), quantity: String(l.quantity), unit: money(l.unitPriceMinor), total: money(l.lineTotalMinor) })));
  s.totals(
    o.pricesIncludeTax
      ? [
          ["Items", money(o.subtotalMinor)],
          [o.fulfilment === "DELIVERY" ? "Delivery" : "Collection", o.deliveryMinor > 0n ? money(o.deliveryMinor) : "Free"],
          [`Includes ${o.taxName} ${o.taxRateBps / 100}%`, money(inv.taxMinor)],
          ["Total", money(inv.totalMinor)],
        ]
      : [
          ["Subtotal", money(o.subtotalMinor)],
          [`${o.taxName} ${o.taxRateBps / 100}%`, money(inv.taxMinor)],
          ["Total", money(inv.totalMinor)],
        ],
  );
  if (inv.creditNotes.length) s.block("Credited", inv.creditNotes.map((c) => `${date(c.issuedAt)}: ${money(c.totalMinor)}, credit note ${c.number}`).join("\n"));
  if (o.payments.length) s.block("Received", o.payments.map((p) => `${date(p.receivedOn)}: ${money(p.amountMinor)}${p.reference ? `, ${p.reference}` : ""}`).join("\n"));
  if (o.refunds.length) s.block("Paid back to you", o.refunds.map((r) => `${date(r.paidOn)}: ${money(r.amountMinor)}${r.reference ? `, ${r.reference}` : ""}`).join("\n"));
  if (state === "PAID") s.block("Paid", m.overpaid ? `Paid in full. We owe you ${money(m.overpaid)}, which we pay back.` : "Paid in full. Thank you.");
  else {
    s.block(state === "OVERDUE" ? "Overdue" : "To pay", `${money(m.outstanding)} by ${date(inv.dueAt)}.`);
    if (o.bankDetails) s.block("Pay into", `${o.bankDetails}\nReference: ${o.number}`);
  }
  s.button("See the order online", `${ctx.appUrl}/orders/${encodeURIComponent(o.number)}`);
  return s.finish();
}
