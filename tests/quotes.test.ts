import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { parseRate } from "../src/lib/pricing";
import { quoteUnitPrice } from "../src/lib/quote-pricing";
import { setRate } from "../src/server/pricing/rates";
import { CUSTOMER_QUOTE_INCLUDE, acceptQuote, declineQuote, quoteByToken, quoteForCustomer } from "../src/server/quotes/customer";
import { requestQuote, type QuoteRequestInput } from "../src/server/quotes/intake";
import { handleInbound } from "../src/server/quotes/mailbox";
import { quotePdf } from "../src/server/quotes/pdf";
import { requestPrices, sendQuote } from "../src/server/quotes/pricing";
import { RulesReader, type QuoteReader, type ReplyLine } from "../src/server/quotes/reader";
import { quoteReport } from "../src/server/quotes/report";
import { addLine, cancelQuote, getQuote, updateLine, updateQuoteRules } from "../src/server/quotes/staff";
import { answerRequest, enterSupplierPrices, markSentByHand, requestByToken } from "../src/server/quotes/suppliers";
import { quoteTick } from "../src/server/quotes/tick";
import { updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSupplier, saveOffer, setSupplierCategories } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, lastSecret, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const HOUR = 60 * 60 * 1000;
const PDF = { name: "certificate.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")) };
type Staff = Awaited<ReturnType<typeof makeStaff>>;
type Org = Awaited<ReturnType<typeof makeOrganisation>>;

/** Reads supplier replies as a test says, so the AI path runs without calling the API. */
class ScriptedReader implements QuoteReader {
  readonly name = "scripted";
  private rules = new RulesReader();
  constructor(private reply: (lines: { ref: string }[]) => ReplyLine[] | null) {}
  readRequest(input: Parameters<QuoteReader["readRequest"]>[0]) {
    return this.rules.readRequest(input);
  }
  async readSupplierReply(input: { lines: { ref: string }[] }) {
    return this.reply(input.lines);
  }
}

let admin: Staff;
let sales: Staff;
let categoryId: string;
let categoryName: string;
let mailSupplier: { id: string; email: string };
let chatSupplier: { id: string };
let reseller: Org;
const deps = { key: KEY, reader: new RulesReader(), replyTo: "quotes@example.co.bw" };

async function product(cost: string) {
  const mpn = `QT${tag()}`;
  const p = await createProduct(db, admin, { name: `Access point ${mpn}`, brand: "Ubiquiti", mpn, categoryId, summary: "", description: "", warrantyMonths: "24", warrantyTerms: "Manufacturer", sellToIndividuals: false, status: "ACTIVE", sourcingRule: null });
  await saveOffer(db, admin, { supplierId: mailSupplier.id, productId: p.id, cost, supplierSku: "", leadTimeDays: "6", moq: "", stock: "", active: true });
  return p;
}

async function approvedReseller(): Promise<Org> {
  const org = await makeOrganisation(`Quotes ${tag()}`, "RESELLER");
  await saveBusinessDetails(db, org.owner, { name: `Quotes ${tag()}`, registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 9, Gaborone", directors: "Neo Kgosi" });
  await addDocument(db, org.owner, "REGISTRATION", PDF);
  await addDocument(db, org.owner, "TAX", PDF);
  await submitForCheck(db, org.owner, {});
  await approveOrganisation(db, admin, { key: KEY }, org.organisationId);
  return org;
}

const ask = (o: Partial<QuoteRequestInput> = {}): QuoteRequestInput => ({ type: "STANDARD", text: "", urgent: false, customerReference: "", tenderReference: "", tenderDeadline: "", requiredDocuments: "", phone: "", ...o });
const who = (org: Org) => ({ userId: org.owner.userId, organisationId: org.organisationId, role: org.owner.role });

/** Asks for a quote and runs the job until it settles. */
async function quoteFor(org: Org, input: Partial<QuoteRequestInput>, now = new Date()) {
  const q = await requestQuote(db, { ...deps, now }, who(org), ask(input));
  await quoteTick(db, { ...deps, now });
  return getQuote(db, q.id);
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  sales = await makeStaff("SALES");
  await setRate(db, admin, "BWP", "13.65");
  await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123" });
  const name = `Wireless ${tag()}`;
  const cat = await createCategory(db, admin, { name, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null });
  categoryId = cat.id;
  categoryName = name;
  const supplier = (n: string, o: { email?: string; whatsapp?: string }) =>
    createSupplier(db, admin, { name: `${n} ${tag()}`, kind: "LOCAL", country: "ZA", currency: "USD", email: o.email ?? "", whatsapp: o.whatsapp ?? "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "0", preferred: false, active: true });
  const m = await supplier("Mail Supplier", { email: `rfq-${tag().toLowerCase()}@example.co.za` });
  mailSupplier = { id: m.id, email: m.email! };
  chatSupplier = await supplier("Chat Supplier", { whatsapp: "+86 138 0000 0000" });
  await setSupplierCategories(db, admin, m.id, [categoryId]);
  await setSupplierCategories(db, admin, chatSupplier.id, [categoryId]);
  reseller = await approvedReseller();
});

describe.skipIf(!hasDb)("requests priced from the catalogue", () => {
  it("reads typed lines, prices them at the reseller level and sends the quote by itself", async () => {
    const a = await product("500.00");
    const b = await product("120.00");
    const q = await quoteFor(reseller, { text: `Hello,\n2 x ${a.mpn}\n${b.mpn} - 10\nThanks`, customerReference: "PO-QUOTE-1" });
    expect(q.status).toBe("SENT");
    expect(q.sentByLabel).toBe("Automatically");
    expect(q.lines.map((l) => [l.quantity, l.productId, l.matchConfidence, l.costSource])).toEqual([
      [2, a.id, 100, "CATALOGUE"],
      [10, b.id, 100, "CATALOGUE"],
    ]);
    const unit = quoteUnitPrice({ amountMinor: 500_00n, currency: "USD" }, 1200, { currency: "BWP", fxBufferBps: 200, roundToMinor: 100 }, parseRate("13.65")).amountMinor;
    expect(q.lines[0].unitPriceMinor).toBe(unit);
    expect(q.subtotalMinor! + q.taxMinor!).toBe(q.totalMinor);
    expect(q.marginBps).toBeGreaterThan(800);
    expect(q.paymentTerms).toMatch(/bank transfer/);
    expect(q.validUntil!.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * HOUR);
    expect(await db.outboundEmail.count({ where: { toAddress: reseller.email, kind: "quote.sent" } })).toBeGreaterThan(0);
    expect(await db.outboundEmail.count({ where: { toAddress: reseller.email, kind: "quote.received" } })).toBeGreaterThan(0);

    // The customer sees our lines and prices, never the supplier or the cost.
    const { token } = await lastSecret(reseller.email, "quote.sent");
    const seen = await quoteByToken(db, q.number, token);
    expect(seen?.lines).toHaveLength(2);
    expect(JSON.stringify(seen, (_, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/supplier|unitCostBase|costSource|marginBps|Mail Supplier/i);
    expect(Object.keys(CUSTOMER_QUOTE_INCLUDE.lines.select)).not.toContain("supplierId");
    expect(await quoteByToken(db, q.number, "wrong")).toBeNull();
    expect(await quoteForCustomer(db, q.number, { userId: null, organisationId: reseller.organisationId })).not.toBeNull();
    expect(await quoteForCustomer(db, q.number, { userId: reseller.owner.userId, organisationId: null })).toBeNull();

    // The PDF carries the number and totals and nothing about suppliers.
    const pdf = Buffer.from(await quotePdf(seen!, { appUrl: "https://ictdistribution.africa", legalName: "ICT Distribution Africa", token }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).not.toMatch(/Mail Supplier/);
  });

  it("waits for a person when a line is unclear, and goes once it is checked", async () => {
    const a = await product("80.00");
    const q = await quoteFor(reseller, { text: `${a.mpn}\n3 x ${a.mpn}` });
    expect(q.status).toBe("REVIEW");
    expect(q.reviewReasons).toMatch(/Line 1, .*No quantity given/);
    await expect(sendQuote(db, sales, deps, q.id)).rejects.toThrow(/Line 1 is flagged/);
    await expect(updateLine(db, await makeStaff("SUPPORT"), deps, q.lines[0].id, { description: "x", quantity: "1", reference: "", categoryId: "", cost: "", leadTimeDays: "", price: "" })).rejects.toThrow(/role/);
    await updateLine(db, sales, deps, q.lines[0].id, { description: q.lines[0].description, quantity: "4", reference: a.mpn, categoryId: "", cost: "", leadTimeDays: "", price: "" });
    const checked = await getQuote(db, q.id);
    expect(checked.lines[0]).toMatchObject({ quantity: 4, flagReason: null, matchConfidence: 100, costSource: "CATALOGUE" });
    expect(checked.reviewReasons).toBeNull();
    await sendQuote(db, sales, deps, q.id);
    expect((await getQuote(db, q.id)).status).toBe("SENT");
  });

  it("keeps quotes outside the value and margin rules for review", async () => {
    const a = await product("900.00");
    await updateQuoteRules(db, admin, { automationEnabled: true, maxAutoValue: "1000", minMarginPercent: "8", minMatchConfidence: "90", supplierHours: "24", urgentSupplierHours: "6", validityDays: "14", tenderMarkupPercent: "", projectMarkupPercent: "", tenderReminderHours: "72" });
    try {
      const big = await quoteFor(reseller, { text: `5 x ${a.mpn}` });
      expect(big.status).toBe("REVIEW");
      expect(big.reviewReasons).toMatch(/above US\$1,000\.00/);
      // A typed price below cost breaks the margin rule.
      await updateLine(db, sales, deps, big.lines[0].id, { description: big.lines[0].description, quantity: "1", reference: a.mpn, categoryId: "", cost: "", leadTimeDays: "", price: "5000" });
      expect((await getQuote(db, big.id)).reviewReasons).toMatch(/margin is below 8%/);
      await expect(updateQuoteRules(db, sales, { automationEnabled: true, maxAutoValue: "1", minMarginPercent: "8", minMatchConfidence: "90", supplierHours: "24", urgentSupplierHours: "6", validityDays: "14", tenderMarkupPercent: "", projectMarkupPercent: "", tenderReminderHours: "72" })).rejects.toThrow(/role/);
      await expect(updateQuoteRules(db, admin, { automationEnabled: true, maxAutoValue: "1", minMarginPercent: "8", minMatchConfidence: "101", supplierHours: "6", urgentSupplierHours: "12", validityDays: "14", tenderMarkupPercent: "", projectMarkupPercent: "", tenderReminderHours: "72" })).rejects.toMatchObject({ fieldErrors: { minMatchConfidence: expect.any(String), urgentSupplierHours: expect.any(String) } });
    } finally {
      await updateQuoteRules(db, admin, { automationEnabled: true, maxAutoValue: "5000", minMarginPercent: "8", minMatchConfidence: "90", supplierHours: "24", urgentSupplierHours: "6", validityDays: "14", tenderMarkupPercent: "", projectMarkupPercent: "", tenderReminderHours: "72" });
    }
  });

  it("uses the tender markup when one is set", async () => {
    const a = await product("200.00");
    await updateQuoteRules(db, admin, { automationEnabled: true, maxAutoValue: "5000", minMarginPercent: "8", minMatchConfidence: "90", supplierHours: "24", urgentSupplierHours: "6", validityDays: "14", tenderMarkupPercent: "30", projectMarkupPercent: "", tenderReminderHours: "72" });
    try {
      const deadline = new Date(Date.now() + 10 * 24 * HOUR).toISOString().slice(0, 16);
      await expect(requestQuote(db, deps, who(reseller), ask({ type: "TENDER", text: `1 x ${a.mpn}` }))).rejects.toMatchObject({ fieldErrors: { tenderReference: expect.any(String), tenderDeadline: expect.any(String) } });
      const q = await quoteFor(reseller, { type: "TENDER", text: `1 x ${a.mpn}`, tenderReference: "PPADB/2026/17", tenderDeadline: deadline, requiredDocuments: "Tax clearance\nDatasheets" });
      expect(q).toMatchObject({ status: "SENT", includeDocuments: true });
      const unit = quoteUnitPrice({ amountMinor: 200_00n, currency: "USD" }, 3000, { currency: "BWP", fxBufferBps: 200, roundToMinor: 100 }, parseRate("13.65")).amountMinor;
      expect(q.lines[0].unitPriceMinor).toBe(unit);
    } finally {
      await updateQuoteRules(db, admin, { automationEnabled: true, maxAutoValue: "5000", minMarginPercent: "8", minMatchConfidence: "90", supplierHours: "24", urgentSupplierHours: "6", validityDays: "14", tenderMarkupPercent: "", projectMarkupPercent: "", tenderReminderHours: "72" });
    }
  });
});

describe.skipIf(!hasDb)("requests for price to suppliers", () => {
  it("asks every matching supplier, takes their answers and prices the quote", async () => {
    const start = new Date();
    const q = await quoteFor(reseller, { text: `4 x ${categoryName} outdoor bridge kit`, urgent: true }, start);
    // Not a product we list, so its category's suppliers are asked: one by email, one on WhatsApp by hand.
    expect(q.status).toBe("WAITING_ON_SUPPLIERS");
    expect(q.lines[0]).toMatchObject({ productId: null, categoryId, costSource: null });
    const requests = await db.supplierPriceRequest.findMany({ where: { quoteId: q.id }, orderBy: { channel: "asc" } });
    expect(requests.map((r) => [r.supplierId, r.channel, r.status])).toEqual([
      [mailSupplier.id, "EMAIL", "SENT"],
      [chatSupplier.id, "WHATSAPP", "TO_SEND_BY_HAND"],
    ]);
    // Urgent: six hours by default.
    expect(requests[0].deadline.getTime() - start.getTime()).toBe(6 * HOUR);
    const rfq = await db.outboundEmail.findFirstOrThrow({ where: { toAddress: mailSupplier.email, kind: "supplier.rfq" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(rfq.payload)).not.toContain(reseller.email);
    const { token } = await lastSecret(mailSupplier.email, "supplier.rfq");

    // The supplier answers on their page.
    const page = await requestByToken(db, token);
    expect(page?.lines.map((l) => l.quantity)).toEqual([4]);
    const line = q.lines[0].id;
    await expect(answerRequest(db, deps, token, { note: "", lines: [{ lineId: line, noOffer: false, price: "abc", available: "", leadTimeDays: "", validUntil: "", notes: "" }] })).rejects.toMatchObject({ fieldErrors: { [`price-${line}`]: expect.any(String) } });
    await answerRequest(db, deps, token, { note: "Stock in Johannesburg.", lines: [{ lineId: line, noOffer: false, price: "310.00", available: "10", leadTimeDays: "4", validUntil: "", notes: "" }] });
    // The WhatsApp request is still open, so the quote keeps waiting.
    expect((await getQuote(db, q.id)).status).toBe("WAITING_ON_SUPPLIERS");

    // Staff send the WhatsApp link by hand and type in that supplier's answer: they can't supply it.
    await markSentByHand(db, sales, deps, requests[1].id);
    await enterSupplierPrices(db, await makeStaff("PROCUREMENT"), deps, requests[1].id, { note: "", lines: [{ lineId: line, noOffer: true, price: "", available: "", leadTimeDays: "", validUntil: "", notes: "Out of stock" }] });
    const priced = await getQuote(db, q.id);
    // Every supplier has answered, so it is priced at once; a line we don't list always needs a person.
    expect(priced.status).toBe("REVIEW");
    expect(priced.lines[0]).toMatchObject({ costSource: "SUPPLIER", supplierId: mailSupplier.id, unitCostBaseMinor: 310_00n, leadTimeDays: 4 });
    expect(priced.reviewReasons).toMatch(/not a product we list/);
    await expect(answerRequest(db, deps, "not-a-token", { note: "", lines: [] })).rejects.toThrow(/link/);

    await sendQuote(db, sales, deps, q.id);
    expect((await getQuote(db, q.id)).status).toBe("SENT");
    // Answers can't change once it has gone.
    await expect(answerRequest(db, deps, token, { note: "", lines: [{ lineId: line, noOffer: false, price: "1.00", available: "", leadTimeDays: "", validUntil: "", notes: "" }] })).rejects.toThrow(/closed/);
  });

  it("prices with what has arrived when the deadline passes", async () => {
    const start = new Date();
    const q = await quoteFor(reseller, { text: `2 x ${categoryName} ceiling mount` }, start);
    expect(q.status).toBe("WAITING_ON_SUPPLIERS");
    await quoteTick(db, { ...deps, now: new Date(start.getTime() + 25 * HOUR) });
    const after = await getQuote(db, q.id);
    expect(after.status).toBe("REVIEW");
    expect(after.priceRequests.every((r) => r.status === "EXPIRED")).toBe(true);
    expect(after.reviewReasons).toMatch(/no price yet/);

    // Staff type a cost and send it.
    await updateLine(db, sales, deps, after.lines[0].id, { description: after.lines[0].description, quantity: "2", reference: "", categoryId, cost: "40", leadTimeDays: "10", price: "" });
    await expect(requestPrices(db, sales, deps, q.id)).rejects.toThrow(/Every line has a cost/);
    await addLine(db, sales, deps, q.id, { description: "Installation kit", quantity: "2", reference: "", categoryId, cost: "", leadTimeDays: "", price: "" });
    expect(await requestPrices(db, sales, deps, q.id)).toBe(2);
    expect((await getQuote(db, q.id)).status).toBe("WAITING_ON_SUPPLIERS");
  });

  it("reads a supplier's plain email reply, only from their own address", async () => {
    const q = await quoteFor(reseller, { text: `6 x ${categoryName} mesh node` });
    const request = await db.supplierPriceRequest.findFirstOrThrow({ where: { quoteId: q.id, supplierId: mailSupplier.id } });
    const reader = new ScriptedReader((lines) => lines.map((l) => ({ ref: l.ref, noOffer: false, unitPrice: "99.50", currency: "USD", available: 6, leadTimeDays: 7, validUntil: null, notes: "" })));
    const mail = (from: string, id: string) => ({ messageId: id, from, name: "Sales", subject: `Re: Request for price ${request.reference}`, text: "L1: 99.50 each, 6 in stock, a week.", date: new Date(), automatic: false, attachments: [] });

    expect(await handleInbound(db, { ...deps, reader, ownAddresses: [] }, mail("someone@example.net", `<a-${tag()}@x>`))).toBe("supplier-reply");
    expect(await db.supplierQuoteResponse.count({ where: { requestId: request.id } })).toBe(0);
    expect((await db.supplierPriceRequest.findUniqueOrThrow({ where: { id: request.id } })).replyText).toMatch(/99.50/);

    const id = `<b-${tag()}@x>`;
    expect(await handleInbound(db, { ...deps, reader, ownAddresses: [] }, mail(mailSupplier.email, id))).toBe("supplier-reply");
    expect(await handleInbound(db, { ...deps, reader, ownAddresses: [] }, mail(mailSupplier.email, id))).toBe("seen");
    const response = await db.supplierQuoteResponse.findFirstOrThrow({ where: { requestId: request.id } });
    expect(response).toMatchObject({ costMinor: 99_50n, available: 6, leadTimeDays: 7, source: "email" });
  });
});

describe.skipIf(!hasDb)("emailed requests", () => {
  it("makes a quote from a stranger's email that always waits for a person", async () => {
    const a = await product("50.00");
    const from = `buyer-${tag().toLowerCase()}@example.org`;
    const mail = { messageId: `<c-${tag()}@x>`, from, name: "Thato Buyer", subject: "Quote for access points", text: `Please quote 3 x ${a.mpn}`, date: new Date(), automatic: false, attachments: [] };
    expect(await handleInbound(db, { ...deps, ownAddresses: ["quotes@example.co.bw"] }, { ...mail, automatic: true, messageId: `<d-${tag()}@x>` })).toBe("ignored");
    expect(await handleInbound(db, { ...deps, ownAddresses: ["quotes@example.co.bw"] }, mail)).toBe("quote-request");
    const q = await db.quote.findFirstOrThrow({ where: { email: from } });
    expect(q).toMatchObject({ source: "EMAIL", customerType: "INDIVIDUAL", userId: null, name: "Thato Buyer" });
    await quoteTick(db, deps);
    const priced = await getQuote(db, q.id);
    expect(priced.status).toBe("REVIEW");
    expect(priced.reviewReasons).toMatch(/without an account/);
  });
});

describe.skipIf(!hasDb)("answering and tracking", () => {
  it("lets the customer accept by the link, tells Sales, and refuses a second answer", async () => {
    const a = await product("60.00");
    const q = await quoteFor(reseller, { text: `2 x ${a.mpn}` });
    expect(q.status).toBe("SENT");
    const { token } = await lastSecret(reseller.email, "quote.sent");
    await expect(acceptQuote(db, deps, q.number, { token: "nope" })).rejects.toThrow(/No such quote/);
    await acceptQuote(db, deps, q.number, { token });
    expect((await getQuote(db, q.id)).status).toBe("ACCEPTED");
    expect(await db.outboundEmail.count({ where: { toAddress: sales.email, kind: "quote.answered" } })).toBeGreaterThan(0);
    await expect(declineQuote(db, deps, q.number, { token }, "Too dear")).rejects.toThrow(/already accepted/);
    const seen = await db.auditEvent.findMany({ where: { organisationId: reseller.organisationId, targetId: q.id, visibleToCustomer: true }, select: { action: true } });
    expect(seen.map((e) => e.action)).toEqual(expect.arrayContaining(["quote.requested", "quote.sent", "quote.accepted"]));
  });

  it("lets only a member who buys answer from their account, and expires quotes nobody answered", async () => {
    const a = await product("70.00");
    const q = await quoteFor(reseller, { text: `1 x ${a.mpn}` });
    await expect(acceptQuote(db, deps, q.number, { viewer: { userId: "x", organisationId: reseller.organisationId, role: "VIEWER", name: "Viewer" } })).rejects.toThrow(/role/);
    await declineQuote(db, deps, q.number, { viewer: { userId: reseller.owner.userId, organisationId: reseller.organisationId, role: "OWNER", name: "Neo Kgosi" } }, "Went with another option");
    expect((await getQuote(db, q.id)).declineReason).toBe("Went with another option");

    const old = await quoteFor(reseller, { text: `1 x ${a.mpn}` });
    await quoteTick(db, { ...deps, now: new Date(Date.now() + 15 * 24 * HOUR) });
    expect((await getQuote(db, old.id)).status).toBe("EXPIRED");
  });

  it("reminds Sales before a tender closes, once", async () => {
    const closes = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16);
    const q = await quoteFor(reseller, { type: "TENDER", text: "Unclear tender line", tenderReference: `T-${tag()}`, tenderDeadline: closes });
    expect(q.status).toBe("REVIEW");
    await quoteTick(db, deps);
    await quoteTick(db, deps);
    expect(await db.outboundEmail.count({ where: { kind: "quote.tender-reminder", toAddress: sales.email, payload: { path: ["number"], equals: q.number } } })).toBe(1);
    await cancelQuote(db, sales, deps, q.id, "The tender was withdrawn");
    expect((await getQuote(db, q.id)).status).toBe("CANCELLED");
  });

  it("reports the win rate by type and category", async () => {
    const r = await quoteReport(db, new Date(Date.now() - HOUR));
    const standard = r.byType.find((t) => t.label === "Standard")!;
    expect(standard.accepted).toBeGreaterThanOrEqual(1);
    expect(standard.lost).toBeGreaterThanOrEqual(2);
    expect(standard.winRate).toBeGreaterThan(0);
    expect(standard.automatic).toBeGreaterThan(0);
    expect(r.byCategory.some((c) => c.label.startsWith("Wireless") && c.requests > 0)).toBe(true);
  });
});
