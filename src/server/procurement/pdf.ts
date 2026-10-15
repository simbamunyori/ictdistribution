import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { sheet } from "@/server/documents/pdf-kit";
import type { SupplierPo } from "./supplier";

/**
 * A purchase order as a PDF for the supplier: what we buy, at what price
 * in their currency, where to deliver and how we pay. Nothing about the
 * customer or our selling price is in it.
 */
export async function purchaseOrderPdf(po: SupplierPo, ctx: { appUrl: string; legalName: string; token?: string; deliverTo: string; paymentTerms: string; timeZone: string }): Promise<Uint8Array> {
  const s = await sheet("Purchase order", po.number);
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: po.currency }, company.staffLocale);
  const date = (d: Date) => formatDate(d, company.staffLocale, ctx.timeZone);
  s.heading([ctx.legalName, company.domain], [`Date: ${date(po.sentAt ?? po.createdAt)}`, po.supplierReference ? `Your reference: ${po.supplierReference}` : "", po.expectedShipDate ? `Ships: ${date(po.expectedShipDate)}` : ""].filter(Boolean));
  s.party("Supplier", po.supplier.name, [`Prices in ${po.currency}, per unit, before tax. Quote ${po.number} on your invoice.`]);
  s.lines(po.lines.map((l) => ({ n: String(l.position), description: l.description, sub: [l.mpn ? `Part ${l.mpn}` : "", l.confirmedQuantity !== null ? `confirmed ${l.confirmedQuantity}` : "", l.shipDate ? `ships ${date(l.shipDate)}` : "", l.serials ? `serials: ${l.serials.split("\n").join(", ")}` : ""].filter(Boolean).join(", "), quantity: String(l.quantity), unit: money(l.unitCostMinor), total: money(l.lineTotalMinor) })), "Unit cost");
  s.totals([["Total", money(po.totalMinor)]]);
  if (ctx.deliverTo) s.block("Deliver to", ctx.deliverTo);
  if (ctx.paymentTerms) s.block("Payment terms", ctx.paymentTerms);
  if (ctx.token) s.button("Confirm and update online", `${ctx.appUrl}/supplier/po/${encodeURIComponent(ctx.token)}`);
  return s.finish();
}
