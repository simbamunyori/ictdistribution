import type { Market, Order, OrderLine } from "@prisma/client";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { sheet } from "@/server/documents/pdf-kit";
import { PAYMENT_LABEL } from "./orders";

/**
 * An order's pro forma invoice: what to pay, by when and into which
 * account, with the order number as the reference. Shop orders show
 * prices with tax; orders from quotes show them before tax, as quoted.
 */
export async function proFormaPdf(o: Order & { lines: OrderLine[]; market: Pick<Market, "locale" | "timeZone" | "supportEmail"> }, ctx: { appUrl: string; legalName: string; token?: string }): Promise<Uint8Array> {
  const s = await sheet("Pro forma invoice", o.number);
  const { locale, timeZone } = o.market;
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: o.currency }, locale);
  const date = (d: Date) => formatDate(d, locale, timeZone);
  s.heading([ctx.legalName, company.domain, o.market.supportEmail ?? ""], [`Date: ${date(o.createdAt)}`, o.payBy && o.status !== "CANCELLED" ? `${o.paymentMethod === "ACCOUNT" ? "Due" : "Pay by"}: ${date(o.payBy)}` : "", `Payment: ${PAYMENT_LABEL[o.paymentMethod]}`].filter(Boolean));
  const where = o.fulfilment === "DELIVERY" ? `Deliver to ${[o.addressLine1, o.addressLine2, o.city, o.postalCode].filter(Boolean).join(", ")}` : `Collect from ${o.collectionText.split("\n")[0] ?? ""}`;
  s.party("Bill to", [o.name, o.email, o.phone].filter(Boolean).join(", "), [o.customerReference ? `Your reference: ${o.customerReference}` : "", where, o.pricesIncludeTax ? `Prices in ${o.currency}, including ${o.taxName}.` : `Prices in ${o.currency}, per unit before ${o.taxName}.`]);
  s.lines(o.lines.map((l, i) => ({ n: String(i + 1), description: l.description, sub: [l.mpn ? `Part ${l.mpn}` : "", l.specialName ?? ""].filter(Boolean).join(", "), quantity: String(l.quantity), unit: money(l.unitPriceMinor), total: money(l.lineTotalMinor) })));
  s.totals(
    o.pricesIncludeTax
      ? [
          ["Items", money(o.subtotalMinor)],
          [o.fulfilment === "DELIVERY" ? "Delivery" : "Collection", o.deliveryMinor > 0n ? money(o.deliveryMinor) : "Free"],
          [`Includes ${o.taxName}`, money(o.taxMinor)],
          ["Total", money(o.totalMinor)],
        ]
      : [
          ["Subtotal", money(o.subtotalMinor)],
          [`${o.taxName} ${o.taxRateBps / 100}%`, money(o.taxMinor)],
          ["Total", money(o.totalMinor)],
        ],
  );
  if (o.status === "CANCELLED") s.block("Cancelled", `This order was cancelled${o.cancelReason ? `: ${o.cancelReason}` : ""}. Do not pay it.`);
  else if (o.paidAt) s.block("Paid", `Paid in full on ${date(o.paidAt)}. Thank you.`);
  else if (o.bankDetails && o.paymentMethod !== "CARD") s.block("Pay into", `${o.bankDetails}\nReference: ${o.number}`);
  s.block("Note", "This is a pro forma invoice, not a tax invoice. We send the tax invoice when the order is delivered.");
  s.button("See the order online", `${ctx.appUrl}/orders/${encodeURIComponent(o.number)}${ctx.token ? `?t=${encodeURIComponent(ctx.token)}` : ""}`);
  return s.finish();
}
