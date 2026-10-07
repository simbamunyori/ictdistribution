import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";

/**
 * Our branded A4 documents (quotations, pro forma invoices, purchase
 * orders): the logo and our details, a box for who it is for, a table of
 * lines, totals, blocks of terms and a page footer. Each document fills
 * these in; the look stays the same.
 */

const A4 = { w: 595.28, h: 841.89 };
export const M = 48;
export const PAGE_WIDTH = A4.w;

function hex(color: string) {
  const n = parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const INK = hex(tokens.light.text);
export const MUTED = hex(tokens.light.textMuted);
export const BRAND = hex(tokens.light.primary);
const LINE = hex(tokens.light.border);
const SURFACE = hex(tokens.light.surface);

/** The standard PDF fonts only know Western European letters; anything else becomes "?" rather than failing. */
export function safe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
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

async function logo(doc: PDFDocument): Promise<PDFImage | null> {
  for (const path of [join(process.cwd(), "public/brand/png/ictd-logo-640.png"), join(process.cwd(), "brand/png/ictd-logo-640.png")]) {
    try {
      return await doc.embedPng(await readFile(path));
    } catch {
      // Try the next place; a document without the logo is better than none.
    }
  }
  return null;
}

function addLink(page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const annot = page.doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  const ref = page.doc.context.register(annot);
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing) (existing as unknown as { push: (r: unknown) => void }).push(ref);
  else page.node.set(PDFName.of("Annots"), page.doc.context.obj([ref]));
}

type TextOptions = { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> };

export interface SheetLine {
  n: string;
  description: string;
  /** Smaller text under the description: part number, lead time, serials. */
  sub?: string;
  quantity: string;
  unit: string;
  total: string;
}

/** A new branded document. `title` (such as "Quotation") and `number` head the right-hand side. */
export async function sheet(title: string, number: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} ${number}`);
  doc.setAuthor(company.name);
  doc.setCreator(company.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const png = await logo(doc);
  let page = doc.addPage([A4.w, A4.h]);
  const pages: PDFPage[] = [page];
  let y = A4.h - M;

  const text = (s: string, x: number, at: number, o: TextOptions = {}) => page.drawText(safe(s), { x, y: at, size: o.size ?? 10, font: o.f ?? font, color: o.color ?? INK });
  const right = (s: string, xRight: number, at: number, o: TextOptions = {}) => text(s, xRight - (o.f ?? font).widthOfTextAtSize(safe(s), o.size ?? 10), at, o);
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - M;
  };
  const room = (h: number) => {
    if (y - h < M + 30) newPage();
  };
  const col = { n: M, desc: M + 26, qty: 360, unit: 450, total: A4.w - M };

  const s = {
    font,
    bold,
    get y() {
      return y;
    },
    set y(v: number) {
      y = v;
    },
    text,
    right,
    room,
    newPage,

    /** Logo and our details on the left; the title, number and `facts` on the right. */
    heading(ours: string[], facts: string[]) {
      if (png) {
        const w = 150;
        const h = (png.height / png.width) * w;
        page.drawImage(png, { x: M, y: y - h, width: w, height: h });
      } else text(company.name, M, y - 16, { size: 16, f: bold, color: BRAND });
      right(title, A4.w - M, y - 14, { size: 20, f: bold, color: BRAND });
      right(number, A4.w - M, y - 32, { size: 11, f: bold });
      facts.forEach((f, i) => right(f, A4.w - M, y - 47 - i * 14));
      y -= Math.max(96, 61 + facts.length * 14);
      for (const l of ours.filter(Boolean)) {
        text(l, M, y, { color: MUTED });
        y -= 13;
      }
      y -= 10;
    },

    /** A shaded box: a small label, a bold first line and up to two more. */
    party(label: string, first: string, more: string[]) {
      const rest = more.filter(Boolean).slice(0, 3);
      const h = 34 + rest.length * 15;
      page.drawRectangle({ x: M, y: y - h + 6, width: A4.w - 2 * M, height: h, color: SURFACE });
      text(label, M + 12, y - 10, { size: 9, f: bold, color: MUTED });
      text(first.slice(0, 110), M + 12, y - 25, { f: bold });
      rest.forEach((r, i) => text(r.slice(0, 120), M + 12, y - 40 - i * 15, { size: i === rest.length - 1 ? 9 : 10, color: i === rest.length - 1 ? MUTED : INK }));
      y -= h + 16;
    },

    /** The lines table, continued on new pages with its heading repeated. */
    lines(rows: SheetLine[], unitLabel = "Unit price") {
      const head = () => {
        text("#", col.n, y, { size: 9, f: bold, color: MUTED });
        text("Description", col.desc, y, { size: 9, f: bold, color: MUTED });
        right("Qty", col.qty + 20, y, { size: 9, f: bold, color: MUTED });
        right(unitLabel, col.unit + 40, y, { size: 9, f: bold, color: MUTED });
        right("Total", col.total, y, { size: 9, f: bold, color: MUTED });
        y -= 6;
        page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1, color: LINE });
        y -= 14;
      };
      head();
      for (const l of rows) {
        const desc = wrap(l.description, font, 10, col.qty - col.desc - 40);
        const sub = l.sub ? wrap(l.sub, font, 8, col.qty - col.desc - 40) : [];
        const h = desc.length * 13 + sub.length * 10 + 8;
        if (y - h < M + 30) {
          newPage();
          head();
        }
        text(l.n, col.n, y);
        desc.forEach((d, i) => text(d, col.desc, y - i * 13));
        sub.forEach((d, i) => text(d, col.desc, y - desc.length * 13 - i * 10 + 1, { size: 8, color: MUTED }));
        right(l.quantity, col.qty + 20, y);
        right(l.unit, col.unit + 40, y);
        right(l.total, col.total, y);
        y -= h;
        page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4.w - M, y: y + 6 }, thickness: 0.5, color: LINE });
      }
    },

    /** Totals under the table; the last one is the total, in bold. */
    totals(rows: [label: string, value: string][]) {
      room(rows.length * 16 + 20);
      y -= 6;
      rows.forEach(([label, value], i) => {
        const strong = i === rows.length - 1;
        right(label, col.unit + 40, y, { f: strong ? bold : font });
        right(value, col.total, y, { f: strong ? bold : font, size: strong ? 12 : 10 });
        y -= strong ? 20 : 15;
      });
      y -= 8;
    },

    /** A titled paragraph, such as payment terms. */
    block(heading: string, body: string) {
      const lines = wrap(body, font, 10, A4.w - 2 * M);
      room(16 + lines.length * 13);
      text(heading, M, y, { f: bold });
      y -= 14;
      for (const l of lines) {
        text(l, M, y);
        y -= 13;
      }
      y -= 8;
    },

    /** A brand-coloured button that opens `url`, with the address beside it. */
    button(label: string, url: string) {
      room(44);
      const w = Math.max(150, bold.widthOfTextAtSize(safe(label), 11) + 40);
      page.drawRectangle({ x: M, y: y - 30, width: w, height: 30, color: BRAND });
      text(label, M + (w - bold.widthOfTextAtSize(safe(label), 11)) / 2, y - 19, { f: bold, color: rgb(1, 1, 1), size: 11 });
      addLink(page, M, y - 30, w, 30, url);
      wrap(url, font, 8, A4.w - 2 * M - w - 16).forEach((u, i) => text(u, M + w + 16, y - 12 - i * 10, { size: 8, color: MUTED }));
      y -= 48;
    },

    /** Linked text at the current line. */
    linkText(label: string, x: number, url: string) {
      text(label, x, y, { color: BRAND });
      addLink(page, x, y - 2, font.widthOfTextAtSize(safe(label), 10), 12, url);
    },

    /** Page numbers on every page, then the file. */
    async finish(): Promise<Uint8Array> {
      pages.forEach((p, i) => p.drawText(safe(`${company.name}   ${number}   Page ${i + 1} of ${pages.length}`), { x: M, y: 24, size: 8, font, color: MUTED }));
      return doc.save();
    },
  };
  return s;
}
