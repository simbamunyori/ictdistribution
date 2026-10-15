/**
 * Whether a purchase order can go to its supplier without anyone
 * approving it. Pure: the caller loads the rules, the supplier and the
 * value. Every rule comes from the admin area.
 */

export interface ProcurementRules {
  autoSend: boolean;
  maxAutoValueMinor: bigint;
  onlyPreferred: boolean;
}

export interface PoForRules {
  supplier: { name: string; active: boolean; preferred: boolean; email: string | null; whatsapp: string | null };
  currency: string;
  /** Its value in the base currency; null when there is no exchange rate. */
  totalBase: bigint | null;
  maxValueText: string;
}

/** Why it waits for approval, in plain words. Empty means it goes out by itself. */
export function poReviewReasons(rules: ProcurementRules, po: PoForRules): string[] {
  const reasons: string[] = [];
  if (!rules.autoSend) reasons.push("Sending by itself is switched off.");
  if (!po.supplier.active) reasons.push(`${po.supplier.name} is switched off.`);
  if (rules.onlyPreferred && !po.supplier.preferred) reasons.push(`${po.supplier.name} isn't a preferred supplier.`);
  if (po.totalBase === null) reasons.push(`There is no exchange rate for ${po.currency}, so its value can't be checked.`);
  else if (po.totalBase > rules.maxAutoValueMinor) reasons.push(`It is above ${po.maxValueText}, the most that goes out by itself.`);
  if (!po.supplier.email && !po.supplier.whatsapp) reasons.push(`We have no email address or WhatsApp number for ${po.supplier.name}.`);
  return reasons;
}

/** Serial numbers typed one per line, or separated by commas or spaces. */
export function readSerials(text: string): string[] {
  return [...new Set(text.split(/[\n,;\t ]+/).map((s) => s.trim()).filter(Boolean))];
}
