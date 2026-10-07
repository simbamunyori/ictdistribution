import { mpnKey } from "./catalogue";
import { currencyInfo, isSupportedCurrency, parseMoney, type Minor } from "./money";

/**
 * Reading supplier price lists, CSV or Excel, into lines we can compare
 * with what we have. Pure: the file is already a table of cells here.
 * Which column holds what is saved per supplier (PriceListFormat).
 */

export type Cell = string | number | boolean | Date | null | undefined;
export type Table = Cell[][];

export const PRICE_LIST_FIELDS = {
  mpn: { label: "Manufacturer part number", required: true },
  cost: { label: "Cost", required: true },
  brand: { label: "Brand", required: false },
  name: { label: "Product name", required: false },
  supplierSku: { label: "Supplier's own code", required: false },
  stock: { label: "Stock", required: false },
  leadTimeDays: { label: "Lead time (days)", required: false },
  moq: { label: "Minimum order quantity", required: false },
  currency: { label: "Currency", required: false },
} as const;

export type PriceListField = keyof typeof PRICE_LIST_FIELDS;
export const PRICE_LIST_FIELD_KEYS = Object.keys(PRICE_LIST_FIELDS) as PriceListField[];

/** Column heading for each field. Unmapped fields are left out. */
export type ColumnMap = Partial<Record<PriceListField, string>>;

export interface ParsedLine {
  /** The line in the file, from 1, counting the heading rows. */
  line: number;
  mpn: string;
  mpnKey: string;
  brand?: string;
  name?: string;
  supplierSku?: string;
  costMinor?: Minor;
  currency: string;
  stock?: number;
  leadTimeDays?: number;
  moq?: number;
  /** Why the line can't be used. */
  error?: string;
}

// ─── CSV ─────────────────────────────────────────────────────────────

/**
 * RFC 4180 CSV, with the separator worked out from the first line: comma,
 * semicolon (common where a comma is the decimal mark) or tab.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ─── Columns ─────────────────────────────────────────────────────────

const GUESSES: Record<PriceListField, RegExp> = {
  mpn: /^(mpn|manufacturer ?part|mfr ?part|mfg ?part|part ?(no|number|#)|p\/n|vendor ?part|model ?(no|number))/i,
  cost: /(dealer|reseller|trade|net|your|unit|cost|buy)[ _-]?(price|cost)|^price|^cost|^unit ?price/i,
  brand: /^(brand|manufacturer|make|vendor|mfr)$/i,
  name: /^(description|product|name|item|title|product ?name|item ?description)/i,
  supplierSku: /^(sku|code|item ?code|stock ?code|our ?code|article)/i,
  stock: /^(stock|qty|quantity|available|availability|soh|on ?hand)/i,
  leadTimeDays: /lead ?time|eta|delivery ?days/i,
  moq: /^(moq|min(imum)? ?(order)? ?(qty|quantity))/i,
  currency: /^(currency|ccy|cur)$/i,
};

/** A first guess at which column is which, from the headings. Staff check it before the first import. */
export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  // Specific fields first, so "Part number" isn't taken for the name.
  for (const f of ["mpn", "supplierSku", "moq", "leadTimeDays", "currency", "brand", "stock", "cost", "name"] as PriceListField[]) {
    const h = headers.find((x) => x.trim() && !used.has(x) && GUESSES[f].test(x.trim()));
    if (h) {
      map[f] = h;
      used.add(h);
    }
  }
  return map;
}

export function missingColumns(map: ColumnMap, headers: string[]): PriceListField[] {
  return PRICE_LIST_FIELD_KEYS.filter((f) => (PRICE_LIST_FIELDS[f].required && !map[f]) || (map[f] && !headers.includes(map[f]!)));
}

// ─── Values ──────────────────────────────────────────────────────────

function text(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

/**
 * A cost cell as minor units. Numbers from Excel are taken to the
 * currency's decimals. Text may carry a symbol, spaces or commas for
 * thousands, or a decimal comma ("1 234,50").
 */
export function readCost(c: Cell, currency: string): Minor {
  const { exponent } = currencyInfo(currency);
  if (typeof c === "number") {
    if (!Number.isFinite(c) || c < 0) throw new Error("not a cost");
    return parseMoney(c.toFixed(exponent), currency);
  }
  let s = text(c).replace(/[^\d.,\-]/g, "");
  if (!s) throw new Error("no cost");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the later one marks the decimals.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Only commas: decimals when one comma has one or two digits after it.
    const after = s.length - lastComma - 1;
    s = s.indexOf(",") === lastComma && after > 0 && after <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const minor = parseMoney(s, currency);
  if (minor < 0n) throw new Error("negative");
  return minor;
}

function whole(c: Cell): number | undefined {
  const t = typeof c === "number" ? c : Number(text(c).replace(/[,\s]/g, ""));
  if (text(c) === "") return undefined;
  if (!Number.isFinite(t) || t < 0) return NaN;
  return Math.floor(t);
}

/**
 * Turns the table into lines, using the saved columns. A line that
 * can't be used keeps its error, so the review screen can show it.
 */
export function readLines(table: Table, columns: ColumnMap, opts: { headerRow: number; currency: string }): { headers: string[]; lines: ParsedLine[] } {
  const headerIndex = Math.max(0, opts.headerRow - 1);
  const headers = (table[headerIndex] ?? []).map(text);
  const col = (f: PriceListField) => (columns[f] ? headers.indexOf(columns[f]!) : -1);
  const idx = Object.fromEntries(PRICE_LIST_FIELD_KEYS.map((f) => [f, col(f)])) as Record<PriceListField, number>;
  const lines: ParsedLine[] = [];
  for (let r = headerIndex + 1; r < table.length; r++) {
    const row = table[r] ?? [];
    if (row.every((c) => text(c) === "")) continue;
    const get = (f: PriceListField) => (idx[f] >= 0 ? row[idx[f]] : undefined);
    const mpn = text(get("mpn")).slice(0, 80);
    const listedCurrency = text(get("currency")).toUpperCase();
    const currency = listedCurrency && isSupportedCurrency(listedCurrency) ? listedCurrency : opts.currency;
    const line: ParsedLine = {
      line: r + 1,
      mpn,
      mpnKey: mpnKey(mpn),
      brand: text(get("brand")).slice(0, 60) || undefined,
      name: text(get("name")).slice(0, 200) || undefined,
      supplierSku: text(get("supplierSku")).slice(0, 80) || undefined,
      currency,
    };
    const errors: string[] = [];
    if (!line.mpnKey) errors.push("No part number");
    if (listedCurrency && !isSupportedCurrency(listedCurrency)) errors.push(`Unknown currency ${listedCurrency}`);
    try {
      line.costMinor = readCost(get("cost"), currency);
      if (line.costMinor === 0n) errors.push("Cost is zero");
    } catch {
      errors.push(`Cost "${text(get("cost"))}" can't be read`);
    }
    for (const f of ["stock", "leadTimeDays", "moq"] as const) {
      const n = whole(get(f));
      if (n === undefined) continue;
      if (Number.isNaN(n) || n > 1_000_000) errors.push(`${PRICE_LIST_FIELDS[f].label} "${text(get(f))}" can't be read`);
      else line[f] = n;
    }
    if (line.moq === 0) line.moq = 1;
    if (errors.length) line.error = errors.join(". ");
    lines.push(line);
  }
  return { headers, lines };
}

/** How far a price moved, in basis points of the old one, rounded. */
export function priceMoveBps(before: Minor, after: Minor): number {
  if (before <= 0n) return 0;
  const diff = after - before;
  return Number(((diff < 0n ? -diff : diff) * 10_000n + before / 2n) / before);
}
