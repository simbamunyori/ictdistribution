import { searchTerms } from "./catalogue";

/**
 * Reading what a buyer asks for, for search and for the site assistant
 * when it runs without Claude: the words to search for, with the other
 * words people use for the same thing, a budget and how many.
 */

/** Words people use for the same thing. Each group matches any of its words. */
export const SYNONYMS: string[][] = [
  ["laptop", "laptops", "notebook", "notebooks"],
  ["desktop", "desktops", "workstation"],
  ["monitor", "monitors", "display", "screen"],
  ["phone", "phones", "smartphone", "mobile", "handset"],
  ["printer", "printers", "mfp", "copier"],
  ["switch", "switches"],
  ["router", "routers", "gateway"],
  ["wifi", "wi-fi", "wireless", "wlan", "access point"],
  ["ups", "uninterruptible", "battery backup"],
  ["server", "servers"],
  ["storage", "nas"],
  ["ssd", "solid state"],
  ["hdd", "hard drive", "hard disk"],
  ["tablet", "tablets", "ipad"],
  ["headset", "headsets", "headphones"],
  ["camera", "cameras", "cctv", "webcam"],
  ["cable", "cables", "patch lead", "patch cord"],
  ["rack", "racks", "cabinet"],
  ["firewall", "firewalls", "utm"],
  ["licence", "licences", "license", "licenses", "subscription"],
  ["projector", "projectors", "beamer"],
  ["keyboard", "keyboards"],
  ["mouse", "mice"],
  ["dock", "docking station", "docks"],
];

const STOP = new Set(
  "a an and are as at be best but buy by can could do for from get give good have help i i'd i'm in is it like looking me my need needs new of office on or our please price prices quote recommend show some something suggest that the them these they this to up us want we what which with within would you your budget under below less than around about cheap cheaper each per person people staff users user team about".split(" "),
);

/** The words in `text` worth searching for, without filler. */
export function needTerms(text: string): string[] {
  return searchTerms(text.replace(/\d[\d,. ]*(k|m)?\b/gi, " ")).filter((t) => !STOP.has(t) && !/^\d/.test(t));
}

/** A search word and the other words for the same thing, as text to look for in a product's search text. */
export function alternatives(term: string): string[] {
  const t = term.toLowerCase();
  const group = SYNONYMS.find((g) => g.includes(t));
  return group ? [t, ...group.filter((w) => w !== t)] : [t];
}

export interface Need {
  terms: string[];
  /** In major units of the visitor's currency, as typed. */
  maxPrice: number | null;
  /** How many units, or people to equip. */
  quantity: number | null;
}

const amount = (s: string) => {
  const m = /^([\d,.\s]+)\s*(k|m)?$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/[\s,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n * (m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1);
};

/** A budget ("under P10,000", "budget of 5k", "below $800 each") and a count ("20-person office", "for 12 users", "5 x"). */
export function readNeed(text: string): Need {
  const t = text.replace(/\u00a0/g, " ");
  let maxPrice: number | null = null;
  const budget = /(?:under|below|less than|up to|max(?:imum)?|within|budget(?: of| is)?|no more than|around|about|<)\s*(?:[A-Z]{3}\s*|[$€£P]\s*|R\s*)?([\d][\d,.\s]*\s*[km]?)\b/i.exec(t);
  if (budget) maxPrice = amount(budget[1]);
  let quantity: number | null = null;
  const count = /\b(\d{1,4})\s*(?:-|\s)?\s*(?:person|people|staff|users?|seats?|employees|learners|students|desks?|x\b|units?|pcs|of\b)/i.exec(t) ?? /\bfor\s+(\d{1,4})\b/i.exec(t) ?? /^\s*(\d{1,4})\s+[a-z]/i.exec(t);
  if (count) quantity = Number(count[1]) || null;
  return { terms: needTerms(t), maxPrice: maxPrice && maxPrice > 0 ? maxPrice : null, quantity };
}

/** Our copy rules for text the assistant writes: no em or en dashes and no exclamation marks. */
export function cleanCopy(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/\.\.(?!\.)/g, ".")
    .trim();
}
