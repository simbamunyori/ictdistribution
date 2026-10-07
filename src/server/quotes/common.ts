import type { PrismaClient, QuoteStatus, QuoteType } from "@prisma/client";
import { DEFAULT_TIME_ZONE, company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import type { QuoteReader } from "./reader";

/**
 * What every part of quoting shares: labels, the rules row, and who is
 * told when staff need to act.
 */

export const QUOTE_TYPE_LABEL: Record<QuoteType, string> = { STANDARD: "Standard", RESELLER_PROJECT: "Reseller project", TENDER: "Tender" };

export const QUOTE_TYPE_DESCRIPTION: Record<QuoteType, string> = {
  STANDARD: "Products for your own business or a customer.",
  RESELLER_PROJECT: "A project you are reselling, such as an office network for a client.",
  TENDER: "A government or enterprise tender, with its reference, closing date and the documents it asks for.",
};

/** As staff read it. */
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  RECEIVED: "Being read",
  WAITING_ON_SUPPLIERS: "Waiting on suppliers",
  REVIEW: "Ready to check",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const QUOTE_STATUS_TONE = { RECEIVED: "neutral", WAITING_ON_SUPPLIERS: "warning", REVIEW: "highlight", SENT: "neutral", ACCEPTED: "positive", DECLINED: "negative", EXPIRED: "neutral", CANCELLED: "neutral" } as const;

/** Still being worked on: the customer sees "being prepared". */
export const OPEN_STATUSES: QuoteStatus[] = ["RECEIVED", "WAITING_ON_SUPPLIERS", "REVIEW"];

/** As the customer reads it. */
export function customerStatusText(status: QuoteStatus): string {
  if (OPEN_STATUSES.includes(status)) return "Being prepared";
  if (status === "SENT") return "Ready for you";
  return QUOTE_STATUS_LABEL[status];
}

export interface QuoteDeps {
  /** Seals the links in queued emails and supplier requests. */
  key: string;
  now?: Date;
  /** Reads requests and supplier replies. Defaults to Claude, or the rules without a key. */
  reader?: QuoteReader;
  /** Where supplier replies should go: the quotes mailbox. */
  replyTo?: string;
}

export async function quoteSettings(db: Pick<PrismaClient, "quoteSettings">) {
  return db.quoteSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

/** Sales staff, who answer for quotes; Admins when there are none. */
export async function salesAddresses(db: Pick<PrismaClient, "user">): Promise<string[]> {
  const active = { kind: "STAFF" as const, deactivatedAt: null };
  const sales = await db.user.findMany({ where: { ...active, staffRole: "SALES" }, select: { email: true } });
  const people = sales.length ? sales : await db.user.findMany({ where: { ...active, staffRole: "ADMIN" }, select: { email: true } });
  return people.map((p) => p.email);
}

/** Dates in staff emails and the admin area. */
export const staffWhen = (d: Date) => formatDateTime(d, company.staffLocale, DEFAULT_TIME_ZONE);

export const moneyIn = (currency: string, locale: string) => (amountMinor: bigint) => formatMoney({ amountMinor, currency }, locale);

/** "L3": how a line is named to suppliers. */
export const lineRef = (position: number) => `L${position}`;

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
