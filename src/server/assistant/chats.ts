import type { Prisma, PrismaClient } from "@prisma/client";
import { cleanCopy } from "@/lib/assistant";
import { currencyInfo, formatMoney } from "@/lib/money";
import { audit, SYSTEM_ACTOR, staffAudit } from "@/server/audit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { findProducts } from "@/server/catalogue/search";
import { shopCategories } from "@/server/catalogue/shop";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { salesAddresses } from "@/server/quotes/common";
import { canBuy, type PriceContext } from "@/server/shop/prices";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import type { AssistantEngine, ProductSummary, Visitor } from "./engine";

/**
 * Conversations with the site assistant. Each is found again by a secret
 * kept in the visitor's cookie, so nobody else can read it. The visitor
 * can turn a drafted quote request into a real one (signed in, on the
 * quote form) or pass the conversation to Sales, who see it in
 * /admin/assistant and are emailed.
 */

type Db = PrismaClient;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Product slugs shown with an assistant message. */
  products?: string[];
  /** The assistant offered to pass the visitor to Sales. */
  offerSales?: boolean;
  at: string;
}

export interface QuoteLine {
  description: string;
  quantity: number;
}

export async function assistantSettings(db: Pick<PrismaClient, "assistantSettings">) {
  return db.assistantSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

export const chatMessages = (c: { messages: Prisma.JsonValue }): ChatMessage[] => (Array.isArray(c.messages) ? (c.messages as unknown as ChatMessage[]) : []);
export const chatQuoteLines = (c: { quoteDraft: Prisma.JsonValue | null }): QuoteLine[] => (Array.isArray(c.quoteDraft) ? (c.quoteDraft as unknown as QuoteLine[]) : []);

/** The quote form's text for drafted lines: one per line, "5 x description". */
export const quoteText = (lines: QuoteLine[]) => lines.map((l) => `${l.quantity} x ${l.description}`).join("\n");

export async function chatByToken(db: Pick<PrismaClient, "assistantChat">, token: string | undefined | null) {
  if (!token) return null;
  return db.assistantChat.findUnique({ where: { tokenHash: hashToken(token) } });
}

export interface AskInput {
  /** The secret from the visitor's cookie, if they have a conversation. */
  token: string | null;
  text: string;
  visitor: Visitor & { userId: string | null; organisationId: string | null; marketCode: string; locale: string };
  prices: PriceContext;
}

/** What a visitor may know about a product: what the shop shows them, never supplier or cost. */
export function summarise(card: Awaited<ReturnType<typeof findProducts>>["items"][number], prices: PriceContext, locale: string): ProductSummary {
  const days = card.price?.leadTimeDays ?? null;
  return {
    slug: card.slug,
    brand: card.brand,
    name: card.name,
    mpn: card.mpn,
    category: card.category,
    summary: card.summary,
    highlights: card.highlights,
    price: card.price ? formatMoney(card.price.amount, locale) : null,
    priceMinor: card.price?.amount.amountMinor ?? null,
    canBuy: Boolean(card.price) && canBuy(prices, card),
    leadTime: days === null ? null : days <= 1 ? "next working day" : `about ${days} working days`,
  };
}

/**
 * The visitor says something; the assistant answers. Starts a conversation
 * when there is none. Returns the conversation and, for a new one, the
 * secret to keep in the cookie.
 */
export async function askAssistant(db: Db, engine: AssistantEngine, input: AskInput) {
  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new DomainError("invalid", "Type what you are looking for.", "text");
  const settings = await assistantSettings(db);
  if (!settings.enabled) throw new DomainError("conflict", "The assistant is off just now. Search the products, or ask us for a quote.");
  let token = input.token;
  let chat = await chatByToken(db, token);
  // A conversation started before signing in carries on; another person's never does.
  if (chat && (chat.status !== "OPEN" || (chat.userId !== null && chat.userId !== input.visitor.userId))) chat = null;
  if (chat && chat.userMessages >= settings.maxMessages) throw new DomainError("conflict", "This conversation is long enough for us. Start a new one, or ask our Sales team.");
  const history = chat ? chatMessages(chat) : [];
  const categories = (await shopCategories(db)).flatMap((c) => [{ slug: c.slug, name: c.name }, ...c.children.map((s) => ({ slug: s.slug, name: `${c.name} / ${s.name}` }))]);
  const exponent = currencyInfo(input.prices.market.currency).exponent;
  const out = await engine.reply({
    visitor: input.visitor,
    history: history.map((m) => ({ role: m.role, text: m.text })),
    message: text,
    categories,
    search: async (s) => {
      const max = s.maxPrice && s.maxPrice > 0 ? BigInt(Math.round(s.maxPrice * 10 ** exponent)) : null;
      const found = await findProducts(db, { query: s.query, category: s.category ?? null, maxPriceMinor: max, limit: 8 }, input.prices);
      return found.items.map((c) => summarise(c, input.prices, input.visitor.locale));
    },
  });
  const now = new Date().toISOString();
  const messages: ChatMessage[] = [...history, { role: "user", text, at: now }, { role: "assistant", text: cleanCopy(out.text), products: out.products, ...(out.handover ? { offerSales: true } : {}), at: now }];
  const data = { messages: messages as unknown as Prisma.InputJsonValue, userMessages: { increment: 1 }, ...(out.quoteLines ? { quoteDraft: out.quoteLines as unknown as Prisma.InputJsonValue } : {}) };
  if (chat) chat = await db.assistantChat.update({ where: { id: chat.id }, data: { ...data, ...(chat.userId === null && input.visitor.userId ? { userId: input.visitor.userId, organisationId: input.visitor.organisationId, standing: input.visitor.standing } : {}) } });
  else {
    token = newToken();
    chat = await db.assistantChat.create({ data: { tokenHash: hashToken(token), userId: input.visitor.userId, organisationId: input.visitor.organisationId, marketCode: input.visitor.marketCode, standing: input.visitor.standing, messages: messages as unknown as Prisma.InputJsonValue, userMessages: 1, ...(out.quoteLines ? { quoteDraft: out.quoteLines as unknown as Prisma.InputJsonValue } : {}) } });
  }
  return { chat, token: token!, handover: out.handover, engine: engine.name };
}

export interface HandoverInput {
  name: string;
  email: string;
  phone: string;
  note: string;
}

/** The visitor asks Sales to take over. Sales are emailed a link to the conversation. */
export async function handOver(db: Db, deps: { key: string }, token: string | null, input: HandoverInput) {
  const fieldErrors: Record<string, string> = {};
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  const phone = input.phone.trim().slice(0, 40);
  if (!name) fieldErrors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Enter an email address like name@example.com.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const chat = await chatByToken(db, token);
  if (!chat) throw new DomainError("not-found", "Start by telling the assistant what you need.");
  if (chat.status === "HANDED_OVER") return chat;
  const settings = await assistantSettings(db);
  return db.$transaction(async (tx) => {
    const updated = await tx.assistantChat.update({ where: { id: chat.id }, data: { status: "HANDED_OVER", handoverName: name, handoverEmail: email, handoverPhone: phone, handoverNote: input.note.trim().slice(0, 1000), handedOverAt: new Date() } });
    const first = chatMessages(chat).find((m) => m.role === "user")?.text ?? "";
    const to = settings.handoverEmail ? [settings.handoverEmail] : await salesAddresses(tx);
    for (const address of to) await queueEmail(tx, deps.key, { to: address, kind: "assistant.handover", payload: { chatId: chat.id, name, email, phone, note: input.note.trim().slice(0, 1000), asked: first.slice(0, 300) } });
    await audit(tx, { ...SYSTEM_ACTOR, action: "assistant.handover", summary: `${name} (${email}) asked the assistant to pass them to Sales`, organisationId: chat.organisationId, subjectUserId: chat.userId, targetType: "AssistantChat", targetId: chat.id, visibleToCustomer: false });
    return updated;
  });
}

// ─── Staff ───────────────────────────────────────────────────────────

export async function staffChats(db: Pick<PrismaClient, "assistantChat">, status: "HANDED_OVER" | "OPEN" | "CLOSED") {
  return db.assistantChat.findMany({ where: { status }, orderBy: status === "HANDED_OVER" ? { handedOverAt: "asc" } : { updatedAt: "desc" }, take: 200 });
}

export async function chatsWaiting(db: Pick<PrismaClient, "assistantChat">) {
  return db.assistantChat.count({ where: { status: "HANDED_OVER" } });
}

export async function closeChat(db: Db, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "handleAssistantChats");
  await db.$transaction(async (tx) => {
    const c = await tx.assistantChat.findUnique({ where: { id }, select: { id: true, status: true, handoverName: true, handoverEmail: true } });
    if (!c) throw new DomainError("not-found", "No such conversation.");
    if (c.status === "CLOSED") return;
    await tx.assistantChat.update({ where: { id }, data: { status: "CLOSED", closedByLabel: actor.name, closedAt: new Date() } });
    await audit(tx, staffAudit(actor, { action: "assistant.closed", summary: `Closed the assistant conversation with ${c.handoverName || "a visitor"}${c.handoverEmail ? ` (${c.handoverEmail})` : ""}`, targetType: "AssistantChat", targetId: id, ipAddress: ip }));
  });
}

export async function updateAssistantSettings(db: Db, actor: StaffActor, input: { enabled: boolean; handoverEmail: string; maxMessages: string }, ip?: string | null) {
  assertStaffCan(actor, "manageAssistant");
  const fieldErrors: Record<string, string> = {};
  const handoverEmail = input.handoverEmail.trim().toLowerCase();
  if (handoverEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handoverEmail)) fieldErrors.handoverEmail = "Enter an email address, or leave it empty to email Sales.";
  const max = Number(input.maxMessages.trim());
  if (!Number.isInteger(max) || max < 5 || max > 200) fieldErrors.maxMessages = "Enter a whole number from 5 to 200.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const data = { enabled: input.enabled, handoverEmail, maxMessages: max, updatedByLabel: actor.name };
  await db.$transaction(async (tx) => {
    await tx.assistantSettings.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
    await audit(tx, staffAudit(actor, { action: "assistant.settings", summary: `Changed the assistant settings: ${data.enabled ? "on" : "off"}, handovers to ${handoverEmail || "Sales"}, at most ${max} messages`, ipAddress: ip }));
  });
}
