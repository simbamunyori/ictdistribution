import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { sheet, M } from "@/server/documents/pdf-kit";
import { QUOTE_TYPE_LABEL } from "./common";
import type { CustomerQuote } from "./customer";

/**
 * The branded quotation as a PDF: our logo and details, the customer,
 * every line with its price, the totals, delivery time, validity,
 * payment terms and bank details, and a link to accept it online. For a
 * tender it also lists each line's warranty and datasheets. Nothing about
 * suppliers or costs is in it.
 */

export interface PdfContext {
  appUrl: string;
  legalName: string;
  /** The link's token, so the Accept link opens without signing in. */
  token?: string;
}

export async function quotePdf(q: CustomerQuote, ctx: PdfContext): Promise<Uint8Array> {
  const s = await sheet("Quotation", q.number);
  const { locale, timeZone } = q.market;
  const money = (n: bigint | null) => (n === null ? "" : formatMoney({ amountMinor: n, currency: q.currency }, locale));
  const date = (d: Date) => formatDate(d, locale, timeZone);
  const quoteUrl = `${ctx.appUrl}/quotes/${encodeURIComponent(q.number)}${ctx.token ? `?t=${encodeURIComponent(ctx.token)}` : ""}`;

  s.heading([ctx.legalName, company.domain, q.market.supportEmail ?? ""], [`Date: ${date(q.sentAt ?? q.createdAt)}`, q.validUntil ? `Valid until: ${date(q.validUntil)}` : "", `Type: ${QUOTE_TYPE_LABEL[q.type]}`].filter(Boolean));
  const refs = [q.customerReference ? `Your reference: ${q.customerReference}` : "", q.tenderReference ? `Tender: ${q.tenderReference}` : "", q.tenderDeadline ? `Closes ${date(q.tenderDeadline)}` : ""].filter(Boolean).join("   ");
  s.party("Prepared for", [q.organisation?.name || q.companyName, q.name, q.email].filter(Boolean).join(", "), [refs, `Prices in ${q.currency}, per unit before ${q.taxName}.`]);
  s.lines(q.lines.map((l) => ({ n: String(l.position), description: l.description, sub: [l.mpn ? `Part ${l.mpn}` : "", l.leadTimeDays ? `about ${l.leadTimeDays} days` : ""].filter(Boolean).join(", "), quantity: String(l.quantity), unit: money(l.unitPriceMinor), total: money(l.lineTotalMinor) })));
  s.totals([
    ["Subtotal", money(q.subtotalMinor)],
    [`${q.taxName} ${q.taxRateBps / 100}%`, money(q.taxMinor)],
    ["Total", money(q.totalMinor)],
  ]);
  if (q.leadTimeDays) s.block("Delivery", `Delivered about ${q.leadTimeDays} days after we receive your order and payment, unless a line says otherwise.`);
  if (q.validUntil) s.block("Validity", `Prices hold until ${date(q.validUntil)}. Exchange rates and supplier prices can change after that.`);
  if (q.paymentTerms) s.block("Payment terms", q.paymentTerms);
  if (q.bankDetails) s.block("Bank details", `${q.bankDetails}\nReference: ${q.number}`);
  s.button("Accept online", quoteUrl);

  // Tender pack: warranty and datasheets per line.
  if (q.includeDocuments) {
    s.newPage();
    s.text("Datasheets and warranty", M, s.y, { size: 14, f: s.bold });
    s.y -= 22;
    for (const l of q.lines) {
      const p = l.product;
      const warranty = p?.warrantyMonths ? `${p.warrantyMonths} months${p.warrantyTerms ? `, ${p.warrantyTerms}` : ""}` : "As given by the manufacturer";
      s.room(42 + (p?.media.length ?? 0) * 12);
      s.text(`${l.position}. ${l.description}`.slice(0, 95), M, s.y, { f: s.bold });
      s.y -= 13;
      s.text(`Warranty: ${warranty}`.slice(0, 110), M + 14, s.y);
      s.y -= 13;
      for (const m of p?.media ?? []) {
        s.linkText(`Datasheet: ${m.alt || m.filename}`.slice(0, 100), M + 14, `${ctx.appUrl}/media/${m.id}`);
        s.y -= 12;
      }
      s.y -= 8;
    }
  }
  return s.finish();
}
