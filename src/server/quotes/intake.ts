import type { CustomerTypeCode, OrgRole, Prisma, PrismaClient, QuoteSource, QuoteType } from "@prisma/client";
import { mpnKey } from "@/lib/catalogue";
import type { Table } from "@/lib/price-list";
import { MAX_LINES, partNumbers, searchWords, type ReadLine } from "@/lib/quote-reading";
import { fromLocalInput } from "@/lib/zoned";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { isPdf } from "@/server/catalogue/media";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { can } from "@/server/org/access";
import { readTable as readSpreadsheet } from "@/server/suppliers/price-lists";
import { QUOTE_TYPE_LABEL, quoteSettings, type QuoteDeps } from "./common";
import { startPricing } from "./pricing";
import { quoteReader } from "./reader";

/**
 * Requests for quote coming in, from the portal or the quotes mailbox,
 * and reading them into lines matched to our catalogue. The customer is
 * told at once that we have it; pricing follows in the background.
 */

export const MAX_REQUEST_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 20_000;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface QuoteRequestInput {
  type: string;
  text: string;
  urgent: boolean;
  customerReference: string;
  tenderReference: string;
  /** yyyy-mm-ddThh:mm in the market's time zone. */
  tenderDeadline: string;
  requiredDocuments: string;
  phone: string;
}

export interface QuoteFile {
  name: string;
  bytes: Uint8Array;
}

export interface Requester {
  userId: string;
  organisationId: string | null;
  /** Their role, when asking for an organisation. */
  role?: OrgRole | null;
}

/** What a file is, or a mistake to show. PDF, Excel (.xlsx) and CSV only. */
export function requestFileType(file: QuoteFile): string {
  if (file.bytes.length > MAX_REQUEST_FILE_BYTES) throw new DomainError("invalid", "The file is larger than 10 MB. Send a smaller one, or paste the lines.", "file");
  if (isPdf(file.bytes)) return "application/pdf";
  if (file.bytes[0] === 0x50 && file.bytes[1] === 0x4b && /\.xlsx$/i.test(file.name)) return XLSX;
  if (/\.(csv|txt)$/i.test(file.name) && !new TextDecoder().decode(file.bytes.slice(0, 4096)).includes("\u0000")) return "text/csv";
  throw new DomainError("invalid", "Send a PDF, an Excel (.xlsx) or a CSV file.", "file");
}

const QUOTE_TYPES: QuoteType[] = ["STANDARD", "RESELLER_PROJECT", "TENDER"];

async function nextNumber(tx: Pick<PrismaClient, "$queryRaw" | "quoteSettings">) {
  const settings = await quoteSettings(tx);
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('quote_number_seq') AS n`;
  return `${settings.quotePrefix}-${n}`;
}

/** A signed-in customer asks for a quote, for themselves or the organisation they act for. */
export async function requestQuote(db: PrismaClient, deps: QuoteDeps, who: Requester, input: QuoteRequestInput, file?: QuoteFile | null) {
  const now = deps.now ?? new Date();
  if (who.organisationId && !(who.role && can({ role: who.role }, "buy"))) throw new DomainError("forbidden", "Your role in this organisation doesn't allow asking for quotes. Ask an Owner or a Buyer.");
  const user = await db.user.findUniqueOrThrow({ where: { id: who.userId } });
  const org = who.organisationId ? await db.organisation.findUniqueOrThrow({ where: { id: who.organisationId } }) : null;
  const market = org ? await db.market.findUniqueOrThrow({ where: { code: org.marketCode } }) : ((user.marketCode ? await db.market.findUnique({ where: { code: user.marketCode } }) : null) ?? (await db.market.findFirstOrThrow({ where: { isDefault: true } })));

  const fieldErrors: Record<string, string> = {};
  const type = input.type as QuoteType;
  if (!QUOTE_TYPES.includes(type)) fieldErrors.type = "Choose what the quote is for.";
  const text = input.text.trim();
  if (text.length > MAX_TEXT) fieldErrors.text = "Keep it under 20,000 characters, or send a file.";
  if (!text && !file) fieldErrors.text = "List what you need, or send a file.";
  const customerReference = input.customerReference.trim();
  if (customerReference.length > 60) fieldErrors.customerReference = "Keep it under 60 characters.";
  const phone = input.phone.replace(/[\s()-]/g, "");
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) fieldErrors.phone = "Enter a phone number we can call, like +267 71 234 567.";
  let tenderReference = "";
  let tenderDeadline: Date | null = null;
  let requiredDocuments = "";
  if (type === "TENDER") {
    tenderReference = input.tenderReference.trim();
    if (tenderReference.length < 2 || tenderReference.length > 80) fieldErrors.tenderReference = "Enter the tender's reference.";
    tenderDeadline = fromLocalInput(input.tenderDeadline, market.timeZone);
    if (!tenderDeadline || tenderDeadline.getTime() <= now.getTime()) fieldErrors.tenderDeadline = "Enter when the tender closes, in the future.";
    requiredDocuments = input.requiredDocuments.trim();
    if (requiredDocuments.length > 2000) fieldErrors.requiredDocuments = "Keep it under 2,000 characters.";
  }
  let fileType: string | null = null;
  if (file) {
    try {
      fileType = requestFileType(file);
    } catch (e) {
      if (e instanceof DomainError) fieldErrors.file = e.message;
      else throw e;
    }
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const customerType: CustomerTypeCode = org?.verification === "APPROVED" ? org.customerType : "INDIVIDUAL";

  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx);
    const quote = await tx.quote.create({
      data: {
        number,
        type,
        source: "PORTAL",
        marketCode: market.code,
        currency: market.currency,
        customerType,
        userId: user.id,
        organisationId: org?.id ?? null,
        email: user.email,
        name: user.name,
        phone,
        customerReference,
        urgent: input.urgent,
        tenderReference,
        tenderDeadline,
        requiredDocuments,
        includeDocuments: type === "TENDER",
        requestText: text,
        fileName: file ? file.name.slice(0, 200) : null,
        fileType,
        file: file ? Buffer.from(file.bytes) : null,
        taxName: market.taxName,
        taxRateBps: market.taxRateBps,
      },
    });
    await queueEmail(tx, deps.key, { to: user.email, kind: "quote.received", payload: { number, name: user.name, type: QUOTE_TYPE_LABEL[type], reference: tenderReference || customerReference } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: user.id, actorLabel: user.name, action: "quote.requested", summary: `Asked for ${QUOTE_TYPE_LABEL[type].toLowerCase()} quote ${number}${customerReference ? `, their reference ${customerReference}` : ""}`, organisationId: org?.id ?? null, subjectUserId: user.id, targetType: "Quote", targetId: quote.id, visibleToCustomer: true });
    return quote;
  });
}

export interface InboundRequest {
  from: string;
  name: string;
  subject: string;
  text: string;
  file?: QuoteFile | null;
}

/**
 * A request emailed to the quotes mailbox. A sender with an account is
 * quoted at their price level; anyone else at Individual prices, and
 * their quote always waits for a person to check it.
 */
export async function requestQuoteByEmail(db: PrismaClient, deps: QuoteDeps, mail: InboundRequest, source: QuoteSource = "EMAIL") {
  const email = mail.from.trim().toLowerCase();
  const user = await db.user.findFirst({ where: { email, kind: "CUSTOMER", deactivatedAt: null }, include: { memberships: { where: { active: true }, include: { organisation: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  const org = user?.memberships[0]?.organisation ?? null;
  const marketCode = org?.marketCode ?? user?.marketCode ?? null;
  const market = (marketCode ? await db.market.findUnique({ where: { code: marketCode } }) : null) ?? (await db.market.findFirstOrThrow({ where: { isDefault: true } }));
  let fileType: string | null = null;
  let file = mail.file ?? null;
  if (file) {
    try {
      fileType = requestFileType(file);
    } catch {
      file = null;
    }
  }
  const tender = /\btender\b/i.test(mail.subject);
  const name = (user?.name ?? mail.name.trim()) || email.split("@")[0];
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx);
    const quote = await tx.quote.create({
      data: {
        number,
        type: tender ? "TENDER" : "STANDARD",
        source,
        marketCode: market.code,
        currency: market.currency,
        customerType: org?.verification === "APPROVED" ? org.customerType : "INDIVIDUAL",
        userId: user?.id ?? null,
        organisationId: org?.id ?? null,
        email,
        name: name.slice(0, 120),
        customerReference: mail.subject.slice(0, 60),
        tenderReference: tender ? mail.subject.slice(0, 80) : "",
        includeDocuments: tender,
        requestText: mail.text.slice(0, MAX_TEXT),
        fileName: file ? file.name.slice(0, 200) : null,
        fileType,
        file: file ? Buffer.from(file.bytes) : null,
        taxName: market.taxName,
        taxRateBps: market.taxRateBps,
      },
    });
    await queueEmail(tx, deps.key, { to: email, kind: "quote.received", payload: { number, name, type: QUOTE_TYPE_LABEL[quote.type], reference: mail.subject.slice(0, 60) } });
    await audit(tx, { ...SYSTEM_ACTOR, actorLabel: `Email from ${email}`, action: "quote.requested", summary: `Request for quote ${number} by email: ${mail.subject.slice(0, 80)}`, organisationId: org?.id ?? null, subjectUserId: user?.id ?? null, targetType: "Quote", targetId: quote.id, visibleToCustomer: Boolean(user) });
    return quote;
  });
}

// ─── Reading ─────────────────────────────────────────────────────────

interface Match {
  productId: string | null;
  categoryId: string | null;
  mpn: string;
  confidence: number;
  /** Our name for it, when the part number made the match certain. */
  name?: string;
  flag?: string;
}

/**
 * Matches a read line to a product: an exact part number is certain
 * (100); a description whose words find exactly one product is likely
 * (70) and checked by a person under the default rules; anything else is
 * not a product we list, priced by asking suppliers of its category.
 */
export async function matchLine(db: Pick<PrismaClient, "product">, line: ReadLine, categoryBySlug: Map<string, string>): Promise<Match> {
  const select = { id: true, name: true, categoryId: true, mpn: true, brand: { select: { name: true } } } as const;
  const keys = [...new Set([line.mpn ?? "", ...partNumbers(line.description), ...partNumbers(line.original)].filter(Boolean).map(mpnKey))].slice(0, 5);
  for (const key of keys) {
    let found = await db.product.findMany({ where: { mpnKey: key, status: "ACTIVE" }, select, take: 5 });
    if (found.length > 1 && line.brand) found = found.filter((p) => p.brand.name.toLowerCase() === line.brand!.toLowerCase());
    if (found.length === 1) return { productId: found[0].id, categoryId: found[0].categoryId, mpn: found[0].mpn, confidence: 100, name: `${found[0].brand.name} ${found[0].name}` };
    if (found.length > 1) return { productId: null, categoryId: found.every((p) => p.categoryId === found[0].categoryId) ? found[0].categoryId : null, mpn: line.mpn ?? "", confidence: 0, flag: "Several of our products have this part number. Choose the right one." };
  }
  const words = searchWords(line.description);
  if (words.length >= 2) {
    const found = await db.product.findMany({ where: { status: "ACTIVE", AND: words.map((w) => ({ searchText: { contains: w } })) }, select, take: 2 });
    if (found.length === 1) return { productId: found[0].id, categoryId: found[0].categoryId, mpn: found[0].mpn, confidence: 70 };
  }
  return { productId: null, categoryId: (line.category && categoryBySlug.get(line.category)) || null, mpn: (line.mpn ?? "").slice(0, 60), confidence: 0 };
}

/**
 * The job: reads a new request into lines and matches them, then starts
 * pricing. Claims the quote first, so it is read once.
 */
export async function readQuote(db: PrismaClient, deps: QuoteDeps, quoteId: string) {
  const now = deps.now ?? new Date();
  const claim = await db.quote.updateMany({ where: { id: quoteId, status: "RECEIVED", readAt: null }, data: { readAt: now } });
  if (claim.count !== 1) return false;
  try {
    const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const categories = await db.category.findMany({ where: { active: true }, select: { id: true, slug: true, name: true } });
    let table: Table | null = null;
    let pdf: QuoteFile | null = null;
    let fileProblem: string | null = null;
    if (q.file && q.fileName) {
      const bytes = new Uint8Array(q.file);
      if (q.fileType === "application/pdf") pdf = { name: q.fileName, bytes };
      else {
        try {
          table = (await readSpreadsheet(bytes, q.fileName)).table;
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          fileProblem = `${q.fileName} couldn't be read: ${e.message}`;
        }
      }
    }
    const reader = deps.reader ?? quoteReader();
    let lines = (await reader.readRequest({ text: q.requestText, table, pdf, categories })).slice(0, MAX_LINES);
    if (fileProblem) lines.push({ original: q.fileName ?? "", description: `Lines from ${q.fileName}`, quantity: null, unclear: fileProblem });
    if (!lines.length) lines = [{ original: q.requestText.slice(0, 200) || (q.fileName ?? ""), description: "The request", quantity: null, unclear: "We couldn't find any lines in it. Read the request and enter them." }];
    const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
    const rows: Prisma.QuoteLineCreateManyInput[] = [];
    for (const [i, l] of lines.entries()) {
      const m = await matchLine(db, l, bySlug);
      rows.push({
        quoteId,
        position: i + 1,
        original: l.original.slice(0, 500),
        description: (m.name ?? l.description).slice(0, 300) || l.original.slice(0, 300),
        mpn: m.mpn.slice(0, 60),
        quantity: l.quantity ?? 1,
        productId: m.productId,
        categoryId: m.categoryId,
        matchConfidence: m.confidence,
        flagReason: (l.unclear ?? m.flag ?? null)?.slice(0, 300) ?? null,
      });
    }
    await db.$transaction(async (tx) => {
      await tx.quoteLine.createMany({ data: rows });
      const flagged = rows.filter((r) => r.flagReason).length;
      const matched = rows.filter((r) => r.productId).length;
      await audit(tx, { ...SYSTEM_ACTOR, action: "quote.read", summary: `Read quote ${q.number} into ${rows.length} ${rows.length === 1 ? "line" : "lines"}: ${matched} matched to our products, ${flagged} flagged (read by ${reader.name})`, targetType: "Quote", targetId: quoteId });
    });
  } catch (e) {
    // Let the next run try again.
    await db.quote.update({ where: { id: quoteId }, data: { readAt: null } });
    throw e;
  }
  await startPricing(db, deps, quoteId);
  return true;
}
