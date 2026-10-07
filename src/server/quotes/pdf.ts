import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
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

const A4 = { w: 595.28, h: 841.89 };
const M = 48;

function hex(color: string) {
  const n = parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const INK = hex(tokens.light.text);
const MUTED = hex(tokens.light.textMuted);
const BRAND = hex(tokens.light.primary);
const LINE = hex(tokens.light.border);
const SURFACE = hex(tokens.light.surface);

/** The standard PDF fonts only know Western European letters; anything else becomes "?" rather than failing. */
function safe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        // A single word wider than the column is cut to fit.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

async function logo(doc: PDFDocument) {
  for (const path of [join(process.cwd(), "public/brand/png/ictd-logo-640.png"), join(process.cwd(), "brand/png/ictd-logo-640.png")]) {
    try {
      return await doc.embedPng(await readFile(path));
    } catch {
      // Try the next place; a quote without the logo is better than none.
    }
  }
  return null;
}

function link(page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const annot = page.doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  const ref = page.doc.context.register(annot);
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing) (existing as unknown as { push: (r: unknown) => void }).push(ref);
  else page.node.set(PDFName.of("Annots"), page.doc.context.obj([ref]));
}

export async function quotePdf(q: CustomerQuote, ctx: PdfContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${q.number}`);
  doc.setAuthor(company.name);
  doc.setCreator(company.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const png = await logo(doc);
  const { locale, timeZone } = q.market;
  const money = (n: bigint | null) => (n === null ? "" : safe(formatMoney({ amountMinor: n, currency: q.currency }, locale)));
  const date = (d: Date) => safe(formatDate(d, locale, timeZone));
  const quoteUrl = `${ctx.appUrl}/quotes/${encodeURIComponent(q.number)}${ctx.token ? `?t=${encodeURIComponent(ctx.token)}` : ""}`;

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const pages: PDFPage[] = [page];
  const text = (s: string, x: number, at: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => page.drawText(safe(s), { x, y: at, size: o.size ?? 10, font: o.f ?? font, color: o.color ?? INK });
  const right = (s: string, xRight: number, at: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => text(s, xRight - (o.f ?? font).widthOfTextAtSize(safe(s), o.size ?? 10), at, o);
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - M;
  };
  const room = (h: number) => {
    if (y - h < M + 30) newPage();
  };

  // Heading: logo and our details on the left, the quote's on the right.
  if (png) {
    const w = 150;
    const h = (png.height / png.width) * w;
    page.drawImage(png, { x: M, y: y - h, width: w, height: h });
  } else text(company.name, M, y - 16, { size: 16, f: bold, color: BRAND });
  right("Quotation", A4.w - M, y - 14, { size: 20, f: bold, color: BRAND });
  right(q.number, A4.w - M, y - 32, { size: 11, f: bold });
  right(`Date: ${date(q.sentAt ?? q.createdAt)}`, A4.w - M, y - 47);
  if (q.validUntil) right(`Valid until: ${date(q.validUntil)}`, A4.w - M, y - 61);
  right(`Type: ${QUOTE_TYPE_LABEL[q.type]}`, A4.w - M, y - 75);
  y -= 96;
  const ours = [ctx.legalName, company.domain, q.market.supportEmail ?? ""].filter(Boolean);
  for (const l of ours) {
    text(l, M, y, { color: MUTED });
    y -= 13;
  }
  y -= 10;

  // For whom.
  page.drawRectangle({ x: M, y: y - 64, width: A4.w - 2 * M, height: 70, color: SURFACE });
  text("Prepared for", M + 12, y - 10, { size: 9, f: bold, color: MUTED });
  const who = [q.organisation?.name || q.companyName, q.name, q.email].filter(Boolean).join(", ");
  text(who.slice(0, 110), M + 12, y - 25, { f: bold });
  const refs = [q.customerReference ? `Your reference: ${q.customerReference}` : "", q.tenderReference ? `Tender: ${q.tenderReference}` : "", q.tenderDeadline ? `Closes ${date(q.tenderDeadline)}` : ""].filter(Boolean).join("   ");
  if (refs) text(refs.slice(0, 120), M + 12, y - 40);
  text(`Prices in ${q.currency}, per unit before ${q.taxName}.`, M + 12, y - 55, { size: 9, color: MUTED });
  y -= 86;

  // Lines.
  const col = { n: M, desc: M + 26, qty: 360, unit: 450, total: A4.w - M };
  const head = () => {
    text("#", col.n, y, { size: 9, f: bold, color: MUTED });
    text("Description", col.desc, y, { size: 9, f: bold, color: MUTED });
    right("Qty", col.qty + 20, y, { size: 9, f: bold, color: MUTED });
    right("Unit price", col.unit + 40, y, { size: 9, f: bold, color: MUTED });
    right("Total", col.total, y, { size: 9, f: bold, color: MUTED });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1, color: LINE });
    y -= 14;
  };
  head();
  for (const l of q.lines) {
    const desc = wrap(l.description, font, 10, col.qty - col.desc - 40);
    const sub = [l.mpn ? `Part ${l.mpn}` : "", l.leadTimeDays ? `about ${l.leadTimeDays} days` : ""].filter(Boolean).join(", ");
    const h = desc.length * 13 + (sub ? 12 : 0) + 8;
    if (y - h < M + 30) {
      newPage();
      head();
    }
    text(String(l.position), col.n, y);
    desc.forEach((d, i) => text(d, col.desc, y - i * 13));
    if (sub) text(sub, col.desc, y - desc.length * 13, { size: 8, color: MUTED });
    right(String(l.quantity), col.qty + 20, y);
    right(money(l.unitPriceMinor), col.unit + 40, y);
    right(money(l.lineTotalMinor), col.total, y);
    y -= h;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4.w - M, y: y + 6 }, thickness: 0.5, color: LINE });
  }

  // Totals.
  room(70);
  y -= 6;
  const total = (label: string, value: string, strong = false) => {
    right(label, col.unit + 40, y, { f: strong ? bold : font });
    right(value, col.total, y, { f: strong ? bold : font, size: strong ? 12 : 10 });
    y -= strong ? 20 : 15;
  };
  total("Subtotal", money(q.subtotalMinor));
  total(`${q.taxName} ${(q.taxRateBps / 100).toString()}%`, money(q.taxMinor));
  total("Total", money(q.totalMinor), true);
  y -= 8;

  // Terms.
  const block = (title: string, body: string) => {
    const lines = wrap(body, font, 10, A4.w - 2 * M);
    room(16 + lines.length * 13);
    text(title, M, y, { f: bold });
    y -= 14;
    for (const l of lines) {
      text(l, M, y);
      y -= 13;
    }
    y -= 8;
  };
  if (q.leadTimeDays) block("Delivery", `Delivered about ${q.leadTimeDays} days after we receive your order and payment, unless a line says otherwise.`);
  if (q.validUntil) block("Validity", `Prices hold until ${date(q.validUntil)}. Exchange rates and supplier prices can change after that.`);
  if (q.paymentTerms) block("Payment terms", q.paymentTerms);
  if (q.bankDetails) block("Bank details", `${q.bankDetails}\nReference: ${q.number}`);

  room(44);
  page.drawRectangle({ x: M, y: y - 30, width: 150, height: 30, color: BRAND });
  text("Accept online", M + 36, y - 19, { f: bold, color: rgb(1, 1, 1), size: 11 });
  link(page, M, y - 30, 150, 30, quoteUrl);
  const shown = wrap(quoteUrl, font, 8, A4.w - 2 * M - 166);
  shown.forEach((s, i) => text(s, M + 166, y - 12 - i * 10, { size: 8, color: MUTED }));
  y -= 48;

  // Tender pack: warranty and datasheets per line.
  if (q.includeDocuments) {
    newPage();
    text("Datasheets and warranty", M, y, { size: 14, f: bold, color: BRAND });
    y -= 22;
    for (const l of q.lines) {
      const p = l.product;
      const warranty = p?.warrantyMonths ? `${p.warrantyMonths} months${p.warrantyTerms ? `, ${p.warrantyTerms}` : ""}` : "As given by the manufacturer";
      const lines = wrap(`${l.position}. ${l.description}`, bold, 10, A4.w - 2 * M);
      room(lines.length * 13 + 16 + (p?.media.length ?? 0) * 12);
      lines.forEach((s, i) => text(s, M, y - i * 13, { f: bold }));
      y -= lines.length * 13;
      text(`Warranty: ${warranty}`, M + 14, y);
      y -= 13;
      for (const m of p?.media ?? []) {
        const url = `${ctx.appUrl}/media/${m.id}`;
        const label = `Datasheet: ${m.alt || m.filename}`;
        text(label, M + 14, y, { color: BRAND });
        link(page, M + 14, y - 2, font.widthOfTextAtSize(safe(label), 10), 12, url);
        y -= 12;
      }
      y -= 8;
    }
  }

  pages.forEach((p, i) => {
    const footer = safe(`${company.name}   ${q.number}   Page ${i + 1} of ${pages.length}`);
    p.drawText(footer, { x: M, y: 24, size: 8, font, color: MUTED });
  });
  return doc.save();
}
