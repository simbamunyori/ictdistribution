import type { PrismaClient, QuoteType } from "@prisma/client";
import { QUOTE_TYPE_LABEL } from "./common";

/**
 * How quoting is going: requests in, quotes sent, how many are won, and
 * how long a quote takes, by request type and by category. A quote counts
 * once in every category it has a line in.
 */

export interface WinRow {
  label: string;
  requests: number;
  sent: number;
  /** Sent without anyone checking it. */
  automatic: number;
  accepted: number;
  /** Declined, or ran out without an answer. */
  lost: number;
  /** Accepted out of those answered or expired. Null with none yet. */
  winRate: number | null;
  /** Average time from request to quote sent. */
  averageMs: number | null;
}

type Row = { type: QuoteType; status: string; createdAt: Date; sentAt: Date | null; sentByLabel: string | null };

function summarise(label: string, quotes: Row[]): WinRow {
  const sent = quotes.filter((q) => q.sentAt);
  const accepted = quotes.filter((q) => q.status === "ACCEPTED").length;
  const lost = quotes.filter((q) => q.status === "DECLINED" || q.status === "EXPIRED").length;
  const times = sent.map((q) => q.sentAt!.getTime() - q.createdAt.getTime());
  return {
    label,
    requests: quotes.length,
    sent: sent.length,
    automatic: sent.filter((q) => q.sentByLabel === "Automatically").length,
    accepted,
    lost,
    winRate: accepted + lost ? accepted / (accepted + lost) : null,
    averageMs: times.length ? times.reduce((s, t) => s + t, 0) / times.length : null,
  };
}

export async function quoteReport(db: PrismaClient, since: Date) {
  const quotes = await db.quote.findMany({
    where: { createdAt: { gte: since }, status: { not: "CANCELLED" } },
    select: { type: true, status: true, createdAt: true, sentAt: true, sentByLabel: true, lines: { select: { categoryId: true } } },
  });
  const categories = await db.category.findMany({ select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } });
  const name = new Map(categories.map((c) => [c.id, c.parent ? `${c.parent.name} / ${c.name}` : c.name]));
  const types: QuoteType[] = ["STANDARD", "RESELLER_PROJECT", "TENDER"];
  const byCategory = new Map<string, Row[]>();
  for (const q of quotes) {
    for (const id of new Set(q.lines.map((l) => l.categoryId ?? "none"))) {
      const list = byCategory.get(id) ?? [];
      list.push(q);
      byCategory.set(id, list);
    }
  }
  return {
    total: summarise("All requests", quotes),
    byType: types.map((t) => summarise(QUOTE_TYPE_LABEL[t], quotes.filter((q) => q.type === t))),
    byCategory: [...byCategory.entries()].map(([id, list]) => summarise(id === "none" ? "No category" : (name.get(id) ?? "A removed category"), list)).sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label)),
  };
}
