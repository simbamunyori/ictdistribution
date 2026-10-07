import type { Table } from "./price-list";

/**
 * Reading a request for quote into lines without AI: typed or pasted
 * lines ("5 x Dell P2425H monitor", "Cat6 patch cable 2m - 40"), or a
 * spreadsheet with quantity and description columns. Used when no AI
 * key is set, and as the fallback when the AI can't be reached. Lines it
 * can't read are kept and flagged for a person.
 */

export interface ReadLine {
  /** The line as the customer wrote it. */
  original: string;
  description: string;
  brand?: string | null;
  /** The manufacturer part number, when one is given. */
  mpn?: string | null;
  /** Null when no quantity is given. */
  quantity: number | null;
  /** One of our category slugs, when it can tell. */
  category?: string | null;
  /** Why a person should look at it. */
  unclear?: string | null;
}

export const MAX_LINES = 200;
const MAX_QUANTITY = 100_000;

const BULLET = /^\s*(?:[-*•·]|\d{1,3}[.)](?=\s))\s*/;
const QTY_FIRST = /^(\d{1,6})\s*(?:x|×|pcs?\.?|units?|no\.?|off|ea\.?)?\s*[-:,]?\s+(.{2,})$/i;
const QTY_LAST = /^(.{2,}?)\s*(?:[-:,]|\bx|×|\bqty:?|\bquantity:?)\s*(\d{1,6})\s*(?:pcs?\.?|units?|off|ea\.?)?$/i;
const QTY_UNITS_LAST = /^(.{2,}?)\s+(\d{1,6})\s*(?:pcs?\.?|units?|off|ea\.?)$/i;

/** A token that looks like a part number: letters and digits together, at least five characters, e.g. 21M7001, SG2428P, KVR56S46BS8-16. */
export function partNumbers(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/[\s,;()[\]/]+/)) {
    const t = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (t.length < 5 || t.length > 40) continue;
    if (!/\d/.test(t) || !/[A-Za-z]/.test(t)) continue;
    // Sizes and speeds such as 512GB, 2.5GHz or 1000Mbps are not part numbers.
    if (/^\d+(\.\d+)?(gb|tb|mb|ghz|mhz|mbps|gbps|w|mm|cm|m|in|inch|hz|mah|v|kva|va|port|ports)$/i.test(t)) continue;
    found.push(t);
  }
  return found;
}

function quantityOf(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 && n <= MAX_QUANTITY ? n : null;
}

/** One typed or pasted line. */
export function readTextLine(raw: string): ReadLine | null {
  const original = raw.trim();
  const text = original.replace(BULLET, "").trim();
  if (text.length < 2) return null;
  // Headings and greetings carry no letters and digits worth quoting.
  if (/^(hi|hello|dear|good (morning|afternoon|day)|regards|kind regards|thanks|thank you)\b/i.test(text)) return null;
  let quantity: number | null = null;
  let description = text;
  const first = QTY_FIRST.exec(text);
  const last = QTY_LAST.exec(text) ?? QTY_UNITS_LAST.exec(text);
  if (first && !/^\d+\s*(gb|tb|port|inch|in|w|m)\b/i.test(text)) {
    quantity = quantityOf(first[1]);
    description = first[2].trim();
  } else if (last) {
    quantity = quantityOf(last[2]);
    description = last[1].trim();
  }
  description = description.replace(/\s+/g, " ").replace(/[-:,]$/, "").trim();
  const mpn = partNumbers(description)[0] ?? null;
  return { original, description, mpn, quantity, unclear: quantity === null ? "No quantity given." : null };
}

/** Typed or pasted text: one line per item. */
export function readText(text: string): ReadLine[] {
  const lines: ReadLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = readTextLine(raw);
    if (l) lines.push(l);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

const HEAD = {
  quantity: /^(qty|qnty|quantity|quantities|units|no\.? of units|count|amount required)$/i,
  description: /^(description|item|items|product|product name|name|item description|details|specification|spec)$/i,
  mpn: /^(part ?(no|number|#)?|mpn|model|model ?(no|number)|sku|code|item code|product code|manufacturer part ?(no|number)?)$/i,
  brand: /^(brand|make|manufacturer|vendor|oem)$/i,
};

const cell = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

/** A spreadsheet or bill of materials: finds the heading row in the first ten, then reads every row under it. */
export function readTable(table: Table): ReadLine[] {
  for (let h = 0; h < Math.min(10, table.length); h++) {
    const heads = (table[h] ?? []).map((c) => cell(c).replace(/[.:]$/, ""));
    const col = (re: RegExp) => heads.findIndex((x) => re.test(x));
    const q = col(HEAD.quantity);
    const d = col(HEAD.description);
    const m = col(HEAD.mpn);
    const b = col(HEAD.brand);
    if (q < 0 || (d < 0 && m < 0)) continue;
    const lines: ReadLine[] = [];
    for (const row of table.slice(h + 1)) {
      const desc = d >= 0 ? cell(row[d]) : "";
      const mpn = m >= 0 ? cell(row[m]) : "";
      const brand = b >= 0 ? cell(row[b]) : "";
      if (!desc && !mpn) continue;
      const qtyText = cell(row[q]).replace(/[^\d.]/g, "");
      const quantity = quantityOf(qtyText);
      const description = [brand && !desc.toLowerCase().includes(brand.toLowerCase()) ? brand : "", desc || mpn].filter(Boolean).join(" ");
      lines.push({
        original: row.map(cell).filter(Boolean).join(" | "),
        description,
        brand: brand || null,
        mpn: mpn || partNumbers(desc)[0] || null,
        quantity,
        unclear: quantity === null ? "No quantity given." : null,
      });
      if (lines.length >= MAX_LINES) break;
    }
    return lines;
  }
  // No heading row: read each row as a typed line.
  return readText(table.map((r) => r.map(cell).filter(Boolean).join(" ")).join("\n"));
}

/**
 * Our best guess at a line's category from its words: a category whose
 * name (or the name without its plural s) appears in the description.
 * The longest name wins, so "access points" beats "points".
 */
export function guessCategory(description: string, categories: { slug: string; name: string }[]): string | null {
  const words = ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { slug: string; length: number } | null = null;
  for (const c of categories) {
    const name = c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const forms = [name, name.replace(/ies$/, "y"), name.replace(/es$/, ""), name.replace(/s$/, "")].filter((f) => f.length >= 3);
    for (const f of forms) {
      if (words.includes(` ${f} `) || words.includes(` ${f}s `) || words.includes(` ${f}es `)) {
        if (!best || f.length > best.length) best = { slug: c.slug, length: f.length };
      }
    }
  }
  return best?.slug ?? null;
}

/** Words worth searching the catalogue for: three letters or more, without filler. */
export function searchWords(description: string): string[] {
  const filler = new Set(["the", "and", "for", "with", "without", "inch", "pcs", "unit", "units", "each", "new", "please", "quote"]);
  return [...new Set(description.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 3 && !filler.has(w)))].slice(0, 8);
}

/** A reference like RFQ-7K2M9Q in an email subject, as staff and suppliers see it. */
export function rfqReferenceIn(subject: string): string | null {
  const m = /\bRFQ-([A-Z0-9]{6})\b/i.exec(subject);
  return m ? `RFQ-${m[1].toUpperCase()}` : null;
}
