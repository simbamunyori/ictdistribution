/**
 * Serial numbers and warranties. Pure, so they are easy to test.
 */

/** A serial number as we match it: upper case, without spaces, dashes, dots or slashes. */
export function serialKey(serial: string): string {
  return serial.toUpperCase().replace(/[\s\-./_]+/g, "");
}

/** The warranty's last moment: just before the same time `months` calendar months after it left us. */
export function warrantyEnd(startsAt: Date, months: number | null | undefined): Date | null {
  if (!months || months <= 0) return null;
  const d = new Date(startsAt);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp to the month's last day: a warranty from 31 January for one month ends at the end of February.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return new Date(d.getTime() - 1);
}

export type WarrantyState = "NOT_SENT" | "IN_WARRANTY" | "ENDED" | "NONE";

export function warrantyState(u: { startsAt: Date | null; endsAt: Date | null; warrantyMonths: number | null }, now: Date): WarrantyState {
  if (!u.startsAt) return "NOT_SENT";
  if (!u.warrantyMonths || !u.endsAt) return "NONE";
  return now.getTime() <= u.endsAt.getTime() ? "IN_WARRANTY" : "ENDED";
}

export const WARRANTY_STATE_LABEL: Record<WarrantyState, string> = { NOT_SENT: "Not sent yet", IN_WARRANTY: "In warranty", ENDED: "Warranty ended", NONE: "No warranty" };
export const WARRANTY_STATE_TONE = { NOT_SENT: "neutral", IN_WARRANTY: "positive", ENDED: "neutral", NONE: "neutral" } as const;
