import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spreadShipping } from "../src/lib/quote-reading";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { setRate } from "../src/server/pricing/rates";
import { requestQuote, type QuoteRequestInput } from "../src/server/quotes/intake";
import { handleInbound } from "../src/server/quotes/mailbox";
import { RulesReader, type QuoteReader, type ReplyLine, type SupplierReplyInput } from "../src/server/quotes/reader";
import { getQuote } from "../src/server/quotes/staff";
import { quoteTick } from "../src/server/quotes/tick";
import { createSupplier, setSupplierCategories } from "../src/server/suppliers/suppliers";
import { CloudApi, parseWebhook, verifyHandshake, verifySignature } from "../src/server/whatsapp/cloud";
import { handleWhatsAppInbound, recordWebhook, requestForMessage, suppliersByNumber } from "../src/server/whatsapp/inbound";
import { deliverWhatsApp, linesValue, templateText } from "../src/server/whatsapp/outbox";
import { db, hasDb, KEY, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const PDF = { name: "certificate.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")) };
const SECRET = "test-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

/** A webhook call as Meta sends it. */
function webhook(value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PNID" }, ...value } }] }] };
}

describe("the webhook", () => {
  it("accepts only calls signed with the app secret", () => {
    const body = JSON.stringify(webhook({ messages: [] }));
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(new Uint8Array(Buffer.from(body)), sign(body), SECRET)).toBe(true);
    expect(verifySignature(`${body} `, sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "another-secret")).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=abc", SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
  });

  it("answers the set-up handshake only with our verify token", () => {
    const ask = (token: string, mode = "subscribe") => new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "1158201444" });
    expect(verifyHandshake(ask("our-token"), "our-token")).toBe("1158201444");
    expect(verifyHandshake(ask("wrong"), "our-token")).toBeNull();
    expect(verifyHandshake(ask("our-token", "unsubscribe"), "our-token")).toBeNull();
    expect(verifyHandshake(ask("our-token"), undefined)).toBeNull();
  });

  it("reads texts, replies, documents, photos and delivery status", () => {
    const parsed = parseWebhook(
      webhook({
        contacts: [{ wa_id: "8613800000001", profile: { name: "Shenzhen Sales" } }],
        messages: [
          { from: "8613800000001", id: "wamid.IN1", timestamp: "1760000000", type: "text", text: { body: "L1 99.50 each" }, context: { from: "26771000000", id: "wamid.OUT1" } },
          { from: "8613800000001", id: "wamid.IN2", timestamp: "1760000001", type: "document", document: { id: "MEDIA1", mime_type: "application/pdf", filename: "quote.pdf", caption: "Our quote" } },
          { from: "8613800000001", id: "wamid.IN3", timestamp: "1760000002", type: "image", image: { id: "MEDIA2", mime_type: "image/jpeg" } },
          { from: "8613800000001", id: "wamid.IN4", timestamp: "1760000003", type: "reaction", reaction: { emoji: "x" } },
        ],
        statuses: [
          { id: "wamid.OUT1", status: "delivered", timestamp: "1760000005", recipient_id: "8613800000001" },
          { id: "wamid.OUT2", status: "failed", timestamp: "1760000006", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Not on WhatsApp" } }] },
          { id: "wamid.OUT3", status: "deleted" },
        ],
      }),
    );
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.messages[0]).toMatchObject({ id: "wamid.IN1", from: "8613800000001", name: "Shenzhen Sales", type: "text", text: "L1 99.50 each", contextId: "wamid.OUT1", media: null });
    expect(parsed.messages[0].at.toISOString()).toBe(new Date(1760000000 * 1000).toISOString());
    expect(parsed.messages[1]).toMatchObject({ type: "document", text: "Our quote", media: { id: "MEDIA1", mimeType: "application/pdf", filename: "quote.pdf" } });
    expect(parsed.messages[2].media).toEqual({ id: "MEDIA2", mimeType: "image/jpeg", filename: "photo" });
    expect(parsed.messages[3]).toMatchObject({ type: "reaction", text: "", media: null });
    expect(parsed.statuses).toEqual([
      { id: "wamid.OUT1", status: "delivered", at: new Date(1760000005 * 1000), error: null },
      { id: "wamid.OUT2", status: "failed", at: new Date(1760000006 * 1000), error: "Message undeliverable: Not on WhatsApp" },
    ]);
    expect(parseWebhook({ object: "page", entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook("nonsense")).toEqual({ messages: [], statuses: [] });
  });

  it("keeps template values on one line and inside WhatsApp's limits", () => {
    expect(templateText("Line one\nLine two\t   spaced", 100)).toBe("Line one Line two spaced");
    expect(templateText("x".repeat(50), 10)).toHaveLength(10);
    const many = Array.from({ length: 40 }, (_, i) => `L${i + 1}: 2 x Ubiquiti U7 Pro access point with mount`);
    const value = linesValue(many);
    expect(value.length).toBeLessThanOrEqual(500);
    expect(value).toMatch(/^L1: 2 x/);
    expect(value).toMatch(/and \d+ more on the page$/);
    expect(linesValue(["L1: 1 x Switch", "L2: 2 x Cable"])).toBe("L1: 1 x Switch; L2: 2 x Cable");
  });

  it("spreads one delivery charge over the priced lines by value", () => {
    const lines = [
      { ref: "L1", noOffer: false, unitPrice: "100.00", shipping: null },
      { ref: "L2", noOffer: false, unitPrice: "50.00", shipping: null },
      { ref: "L3", noOffer: true, unitPrice: null, shipping: null },
      { ref: "L4", noOffer: false, unitPrice: "10.00", shipping: "1.00" },
    ];
    const out = spreadShipping(
      lines,
      new Map([
        ["L1", 2],
        ["L2", 4],
        ["L3", 1],
        ["L4", 5],
      ]),
      "60.00",
      "USD",
    );
    // L1 is worth 200 and L2 200, so each carries 30: 15.00 a unit and 7.50 a unit.
    expect(out.map((l) => l.shipping)).toEqual(["15.00", "7.50", null, "1.00"]);
    expect(spreadShipping(lines, new Map(), null, "USD")).toBe(lines);
  });
});

/** Reads supplier replies as a test says, so the AI path runs without calling the API. */
class ScriptedReader implements QuoteReader {
  readonly name = "scripted";
  private rules = new RulesReader();
  seen: SupplierReplyInput[] = [];
  constructor(private reply: (input: SupplierReplyInput) => ReplyLine[] | null) {}
  readRequest(input: Parameters<QuoteReader["readRequest"]>[0]) {
    return this.rules.readRequest(input);
  }
  async readSupplierReply(input: SupplierReplyInput) {
    this.seen.push(input);
    return this.reply(input);
  }
}

const priced =
  (price: string, shipping: string | null = null) =>
  (input: SupplierReplyInput) =>
    input.lines.map((l) => ({ ref: l.ref, noOffer: false, unitPrice: price, currency: "USD", available: l.quantity, leadTimeDays: 7, validUntil: null, notes: "", shipping }));

const ask = (text: string): QuoteRequestInput => ({ type: "STANDARD", text, urgent: false, customerReference: "", tenderReference: "", tenderDeadline: "", requiredDocuments: "", phone: "" });

/** Fetch stubbed as the Graph API: sends answer with a wamid, media with a PDF. Every call is kept. */
function graph(opts: { send?: (body: Record<string, unknown>) => Response } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let n = 0;
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/messages")) return opts.send ? opts.send(JSON.parse(String(init?.body))) : Response.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.OUT${++n}-${tag()}` }] });
    if (url.includes("/MEDIA")) return Response.json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "application/pdf", file_size: PDF.bytes.length, id: "MEDIA" });
    if (url.startsWith("https://lookaside.fbsbx.com/")) return new Response(PDF.bytes, { headers: { "content-type": "application/pdf", "content-length": String(PDF.bytes.length) } });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

const api = new CloudApi({ token: "test-token", phoneNumberId: "PNID" });
const cfg = { template: "price_request", language: "en" };
const settings = { key: KEY, appUrl: "https://ictdistribution.africa" };

let admin: Awaited<ReturnType<typeof makeStaff>>;
let org: Awaited<ReturnType<typeof makeOrganisation>>;
let soloCategory: string;
let bothCategory: string;
let chat: { id: string; number: string };
let both: { id: string; email: string; number: string };

async function quoteFor(categoryName: string, reader: QuoteReader) {
  const deps = { key: KEY, reader, whatsapp: true };
  const q = await requestQuote(db, deps, { userId: org.owner.userId, organisationId: org.organisationId, role: org.owner.role }, ask(`6 x ${categoryName} mesh node`));
  await quoteTick(db, deps);
  return getQuote(db, q.id);
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  await setRate(db, admin, "BWP", "13.65");
  org = await makeOrganisation(`WhatsApp ${tag()}`, "RESELLER");
  await saveBusinessDetails(db, org.owner, { name: `WhatsApp ${tag()}`, registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 9, Gaborone", directors: "Neo Kgosi" });
  await addDocument(db, org.owner, "REGISTRATION", PDF);
  await addDocument(db, org.owner, "TAX", PDF);
  await submitForCheck(db, org.owner, {});
  await approveOrganisation(db, admin, { key: KEY }, org.organisationId);
  const category = async (name: string) => (await createCategory(db, admin, { name, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
  soloCategory = `Radios ${tag()}`;
  bothCategory = `Antennas ${tag()}`;
  const solo = await category(soloCategory);
  const pair = await category(bothCategory);
  const digits = () => `8613${Math.floor(100000000 + Math.random() * 899999999)}`;
  const supplier = (n: string, o: { email?: string; whatsapp?: string }) => createSupplier(db, admin, { name: `${n} ${tag()}`, kind: "LOCAL", country: "ZA", currency: "USD", email: o.email ?? "", whatsapp: o.whatsapp ?? "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "0", preferred: false, active: true });
  const chatNumber = digits();
  const c = await supplier("WhatsApp Only", { whatsapp: `+${chatNumber.slice(0, 2)} ${chatNumber.slice(2, 5)} ${chatNumber.slice(5)}` });
  chat = { id: c.id, number: chatNumber };
  const bothNumber = digits();
  const b = await supplier("Email And WhatsApp", { email: `rfq-${tag().toLowerCase()}@example.co.za`, whatsapp: `+${bothNumber}` });
  both = { id: b.id, email: b.email!, number: bothNumber };
  await setSupplierCategories(db, admin, chat.id, [solo]);
  await setSupplierCategories(db, admin, both.id, [pair]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.skipIf(!hasDb)("requests for price on WhatsApp", () => {
  it("goes by WhatsApp to a WhatsApp-only supplier, and by both to one with both", async () => {
    const solo = await quoteFor(soloCategory, new RulesReader());
    expect(solo.status).toBe("WAITING_ON_SUPPLIERS");
    const r = solo.priceRequests.find((x) => x.supplierId === chat.id)!;
    expect(r).toMatchObject({ channel: "WHATSAPP", status: "SENT" });
    expect(r.whatsapp).toHaveLength(1);
    expect(r.whatsapp[0]).toMatchObject({ number: chat.number, status: "QUEUED" });

    const pair = await quoteFor(bothCategory, new RulesReader());
    const p = pair.priceRequests.find((x) => x.supplierId === both.id)!;
    expect(p).toMatchObject({ channel: "EMAIL", status: "SENT" });
    expect(p.whatsapp).toHaveLength(1);
    expect(await db.outboundEmail.count({ where: { toAddress: both.email, kind: "supplier.rfq" } })).toBeGreaterThan(0);

    // Sending: the approved template with the lines and the response page, never the customer.
    const calls = graph();
    expect(await deliverWhatsApp(db, api, cfg, settings)).toBeGreaterThanOrEqual(2);
    const sent = calls.filter((c) => c.url.endsWith("/PNID/messages")).map((c) => JSON.parse(String(c.init?.body)));
    const mine = sent.find((s) => s.to === chat.number)!;
    expect(mine.template).toMatchObject({ name: "price_request", language: { code: "en" } });
    const values = mine.template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(values[1]).toBe(r.reference);
    expect(values[3]).toMatch(new RegExp(`L1: 6 x ${soloCategory} mesh node`));
    expect(values[4]).toMatch(/^https:\/\/ictdistribution\.africa\/supplier\/rfq\/.{20,}/);
    expect(JSON.stringify(values).includes(org.email) || JSON.stringify(values).includes("Neo Kgosi")).toBe(false);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const row = await db.whatsAppMessage.findFirstOrThrow({ where: { requestId: r.id } });
    expect(row.status).toBe("SENT");
    expect(row.waMessageId).toMatch(/^wamid\./);
    expect(JSON.stringify(row.payload)).not.toMatch(/sealed/);

    // Delivery and read receipts move it forward, never back.
    await recordWebhook(db, parseWebhook(webhook({ statuses: [{ id: row.waMessageId, status: "read", timestamp: "1760000100" }] })));
    await recordWebhook(db, parseWebhook(webhook({ statuses: [{ id: row.waMessageId, status: "delivered", timestamp: "1760000050" }] })));
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("READ");
  });

  it("hands a WhatsApp-only request back to staff when the message can't go", async () => {
    const q = await quoteFor(soloCategory, new RulesReader());
    const r = q.priceRequests.find((x) => x.supplierId === chat.id)!;
    graph({ send: () => Response.json({ error: { message: "Template name does not exist in the translation", code: 132001 } }, { status: 400 }) });
    await deliverWhatsApp(db, api, cfg, settings);
    const row = await db.whatsAppMessage.findFirstOrThrow({ where: { requestId: r.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(row.lastError).toMatch(/Template name/);
    expect((await db.supplierPriceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("TO_SEND_BY_HAND");
  });

  it("matches a sender to the supplier's own numbers, whatever the format", async () => {
    expect(await suppliersByNumber(db, chat.number)).toEqual([chat.id]);
    expect(await suppliersByNumber(db, `+${chat.number.slice(0, 2)} (${chat.number.slice(2, 5)}) ${chat.number.slice(5)}`)).toEqual([chat.id]);
    expect(await suppliersByNumber(db, "26700000000")).toEqual([]);
    expect(await suppliersByNumber(db, "")).toEqual([]);
    expect(await requestForMessage(db, [], null, "")).toBeNull();
  });

  it("reads a supplier's WhatsApp text, with their delivery cost, and prices the quote in our name", async () => {
    const reader = new ScriptedReader(priced("99.50", "5.00"));
    const q = await quoteFor(soloCategory, reader);
    const r = q.priceRequests.find((x) => x.supplierId === chat.id)!;
    graph();
    await deliverWhatsApp(db, api, cfg, settings);
    const out = await db.whatsAppMessage.findFirstOrThrow({ where: { requestId: r.id, direction: "OUT" } });

    // Someone else's number can't set prices.
    await recordWebhook(db, parseWebhook(webhook({ messages: [{ from: "26799999999", id: `wamid.X${tag()}`, timestamp: "1760000200", type: "text", text: { body: "L1: 1.00 each" }, context: { id: out.waMessageId } }] })));
    // Their reply, using WhatsApp's reply to our message.
    const id = `wamid.IN${tag()}`;
    const body = JSON.stringify(webhook({ messages: [{ from: chat.number, id, timestamp: "1760000300", type: "text", text: { body: "L1: USD 99.50 each, 6 in stock, a week. Delivery USD 5 a unit." }, context: { from: "26771000000", id: out.waMessageId } }] }));
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(await recordWebhook(db, parseWebhook(JSON.parse(body)))).toBe(1);
    // Meta sends again when unsure: stored once.
    expect(await recordWebhook(db, parseWebhook(JSON.parse(body)))).toBe(0);
    await handleWhatsAppInbound(db, { key: KEY, reader }, api);

    expect(await db.whatsAppMessage.findFirstOrThrow({ where: { waMessageId: { startsWith: "wamid.X" }, number: "26799999999" } })).toMatchObject({ status: "IGNORED" });
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: id } })).toMatchObject({ status: "HANDLED", requestId: r.id, supplierId: chat.id });
    expect(reader.seen.at(-1)?.text).toMatch(/99.50/);
    const response = await db.supplierQuoteResponse.findFirstOrThrow({ where: { requestId: r.id } });
    expect(response).toMatchObject({ costMinor: 99_50n, freightMinor: 5_00n, available: 6, leadTimeDays: 7, source: "whatsapp" });

    // The last supplier answered, so the quote is priced at once: landed cost is their price plus their delivery.
    const after = await getQuote(db, q.id);
    expect(after.status).not.toBe("WAITING_ON_SUPPLIERS");
    expect(after.lines[0]).toMatchObject({ costSource: "SUPPLIER", supplierId: chat.id, unitCostBaseMinor: 104_50n });
    expect(after.lines[0].unitPriceMinor).not.toBeNull();
    expect(after.priceRequests.find((x) => x.id === r.id)?.replyText).toMatch(/99.50/);
  });

  it("reads the PDF or photo of their quote they send on WhatsApp", async () => {
    const reader = new ScriptedReader((input) => (input.pdf ? priced("80.00")(input) : null));
    const q = await quoteFor(soloCategory, reader);
    const r = q.priceRequests.find((x) => x.supplierId === chat.id)!;
    const calls = graph();
    await deliverWhatsApp(db, api, cfg, settings);
    // No reply context: their most recent open request.
    const id = `wamid.DOC${tag()}`;
    await recordWebhook(db, parseWebhook(webhook({ messages: [{ from: chat.number, id, timestamp: "1760000400", type: "document", document: { id: "MEDIA9", mime_type: "application/pdf", filename: "Quotation 4411.pdf" } }] })));
    await handleWhatsAppInbound(db, { key: KEY, reader }, api);
    expect(calls.some((c) => c.url.endsWith("/MEDIA9"))).toBe(true);
    expect(reader.seen.at(-1)?.pdf?.name).toBe("Quotation 4411.pdf");
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: id } })).toMatchObject({ status: "HANDLED", requestId: r.id });
    expect(await db.supplierReplyFile.count({ where: { requestId: r.id, channel: "WHATSAPP" } })).toBe(1);
    expect((await db.supplierQuoteResponse.findFirstOrThrow({ where: { requestId: r.id } })).costMinor).toBe(80_00n);
  });

  it("keeps a reply for staff when no AI can read it", async () => {
    const q = await quoteFor(soloCategory, new RulesReader());
    const r = q.priceRequests.find((x) => x.supplierId === chat.id)!;
    const id = `wamid.RULES${tag()}`;
    await recordWebhook(db, parseWebhook(webhook({ messages: [{ from: chat.number, id, timestamp: "1760000500", type: "text", text: { body: `${r.reference}: 70 dollars each` } }] })));
    await handleWhatsAppInbound(db, { key: KEY, reader: new RulesReader() }, api);
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: id } })).toMatchObject({ status: "KEPT", requestId: r.id });
    expect(await db.supplierQuoteResponse.count({ where: { requestId: r.id } })).toBe(0);
    expect((await db.supplierPriceRequest.findUniqueOrThrow({ where: { id: r.id } })).replyText).toMatch(/70 dollars/);
  });
});

describe.skipIf(!hasDb)("email replies with a quote attached", () => {
  it("reads the supplier's PDF quote, not just the text", async () => {
    const q = await quoteFor(bothCategory, new RulesReader());
    const r = q.priceRequests.find((x) => x.supplierId === both.id)!;
    const reader = new ScriptedReader((input) => (input.pdf ? priced("61.25")(input) : null));
    const mail = { messageId: `<pdf-${tag()}@x>`, from: both.email, name: "Sales", subject: `Re: Request for price ${r.reference}`, text: "Please see our quote attached.", date: new Date(), automatic: false, attachments: [{ name: "Q-2231.pdf", type: "application/pdf", bytes: PDF.bytes }] };
    expect(await handleInbound(db, { key: KEY, reader, ownAddresses: [] }, mail)).toBe("supplier-reply");
    expect(reader.seen.at(-1)?.pdf?.name).toBe("Q-2231.pdf");
    expect(await db.supplierQuoteResponse.findFirstOrThrow({ where: { requestId: r.id } })).toMatchObject({ costMinor: 61_25n, source: "email" });
    expect(await db.supplierReplyFile.count({ where: { requestId: r.id, channel: "EMAIL" } })).toBe(1);
  });
});
