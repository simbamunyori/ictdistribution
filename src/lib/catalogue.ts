import type { SpecField } from "@prisma/client";

/**
 * Pure helpers for the catalogue: addresses, part numbers and
 * specification values. Shared by the admin forms, price list imports
 * and the shop.
 */

/** "Wi-Fi extenders" to "wi-fi-extenders". Letters and digits only, joined by dashes. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** A part number for matching: upper case, without spaces, dashes, dots or slashes. "5cd-123.45" and "5CD12345" match. */
export function mpnKey(mpn: string): string {
  return mpn.toUpperCase().replace(/[\s\-./_]+/g, "");
}

export type SpecValue = string | number | boolean;
export type SpecValues = Record<string, SpecValue>;
export type SpecFieldDef = Pick<SpecField, "key" | "label" | "kind" | "unit" | "options" | "filterable" | "highlight" | "mustMatch" | "sortOrder">;

/** A field key: lower case letters, digits and underscores, starting with a letter. */
export const SPEC_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** "Memory (GB)" to "memory_gb", for new fields. */
export function specKey(label: string): string {
  const k = slugify(label).replace(/-/g, "_").slice(0, 40);
  return /^[a-z]/.test(k) ? k : `f_${k}`.slice(0, 40);
}

/**
 * Reads one value typed into a form or found in a price list. Empty means
 * "not given" (undefined). Returns an error message for a value the field
 * can't hold.
 */
export function parseSpecValue(field: Pick<SpecField, "kind" | "options" | "label">, raw: string): { value?: SpecValue; error?: string } {
  const text = raw.trim();
  if (text === "") return {};
  switch (field.kind) {
    case "NUMBER": {
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { error: `${field.label} must be a number.` };
      return { value: n };
    }
    case "YES_NO": {
      const t = text.toLowerCase();
      if (["yes", "y", "true", "1", "on"].includes(t)) return { value: true };
      if (["no", "n", "false", "0", "off"].includes(t)) return { value: false };
      return { error: `${field.label} must be yes or no.` };
    }
    case "CHOICE": {
      const match = field.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (!match) return { error: `${field.label} must be one of: ${field.options.join(", ")}.` };
      return { value: match };
    }
    default:
      if (text.length > 200) return { error: `${field.label} must be under 200 characters.` };
      return { value: text };
  }
}

/** How a value reads on a page: "16 GB", "Yes". */
export function formatSpec(field: Pick<SpecField, "kind" | "unit">, value: SpecValue | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.kind === "YES_NO") return value === true ? "Yes" : "No";
  if (field.kind === "NUMBER" && typeof value === "number") {
    const n = new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
    return field.unit ? `${n} ${field.unit}` : n;
  }
  return String(value);
}

/** What search looks through: name, brand, part number, category and the values of every specification. */
export function searchTextFor(p: { name: string; brand: string; mpn: string; category: string; specs: SpecValues; summary?: string }): string {
  const values = Object.values(p.specs)
    .filter((v) => typeof v !== "boolean")
    .map(String);
  return [p.name, p.brand, p.mpn, mpnKey(p.mpn), p.category, p.summary ?? "", ...values].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Search words, lower-cased, at most eight, each at least two characters. */
export function searchTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .filter((t) => t.length >= 2),
    ),
  ].slice(0, 8);
}

export const MAX_COMPARE = 4;

export const COMPARE_COOKIE = "compare";

/** The ids in the compare cookie: at most four, in the order they were added. */
export function readCompare(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").filter((id) => /^[a-z0-9]{20,32}$/.test(id)))].slice(0, MAX_COMPARE);
}
