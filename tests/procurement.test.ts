import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { setCreditTerms } from "../src/server/accounts/credit";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { poReviewReasons, readSerials, type PoForRules } from "../src/lib/procurement";
import { setRate } from "../src/server/pricing/rates";
import { approvePurchaseOrder, cancelPurchaseOrder, markPoReceived, markPoSentByHand, poLink, poWhatsappLink, procureWaiting, startProcurement, updateProcurementRules, type ProcurementRulesInput } from "../src/server/procurement/purchase-orders";
import { purchaseOrderPdf } from "../src/server/procurement/pdf";
import { addPoDocument, confirmPurchaseOrder, poByToken, readPoDocument, shipPurchaseOrder } from "../src/server/procurement/supplier";
import { acceptQuote } from "../src/server/quotes/customer";
import { requestQuote, type QuoteRequestInput } from "../src/server/quotes/intake";
import { RulesReader } from "../src/server/quotes/reader";
import { getQuote } from "../src/server/quotes/staff";
import { sendQuote } from "../src/server/quotes/pricing";
import { quoteTick } from "../src/server/quotes/tick";
import { addToCart, cartFor } from "../src/server/shop/cart";
import { cancelOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext } from "../src/server/shop/prices";
import { proFormaPdf } from "../src/server/shop/pro-forma";
import { updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSupplier, saveOffer, setSupplierCategories } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, lastSecret, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const PDF = { name: "invoice.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test invoice\n")) };
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
type Staff = Awaited<ReturnType<typeof makeStaff>>;
type Org = Awaited<ReturnType<typeof makeOrganisation>>;

let admin: Staff;
let buyer: Staff;
let categoryId: string;
let mailSupplier: { id: string; email: string; name: string };
let chatSupplier: { id: string; name: string };
let reseller: Org;
const deps = { key: KEY, reader: new RulesReader(), replyTo: "orders@example.co.bw" };

const rules = (o: Partial<ProcurementRulesInput> = {}): ProcurementRulesInput => ({ autoSend: true, maxAutoValue: "100000", onlyPreferred: true, deliverTo: "Plot 50, Gaborone West", paymentTerms: "30 days from invoice", ...o });
const take = (o: Record<string, string> = {}) => ({ phone: "+26771234567", fulfilment: "DELIVERY", addressLine1: "Plot 9", addressLine2: "", city: "Gaborone", postalCode: "", collectionPointId: "", paymentMethod: "ACCOUNT", notes: "", ...o });
const amount = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;

async function product(cost: string, supplierId = mailSupplier.id) {
  const mpn = `PO1${tag()}`;
  const p = await createProduct(db, admin, { name: `Switch ${mpn}`, brand: "Ubiquiti", mpn, categoryId, summary: "", description: "", warrantyMonths: "12", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null });
  await saveOffer(db, admin, { supplierId, productId: p.id, cost, supplierSku: "", leadTimeDays: "4", moq: "", stock: "", active: true });
  return p;
}

const ask = (text: string): QuoteRequestInput => ({ type: "STANDARD", text, urgent: false, customerReference: "PO-CUST-9", tenderReference: "", tenderDeadline: "", requiredDocuments: "", phone: "" });

/** A quote for the reseller, priced and sent to them. */
async function sentQuote(text: string) {
  const q = await requestQuote(db, deps, { userId: reseller.owner.userId, organisationId: reseller.organisationId, role: reseller.owner.role }, ask(text));
  await quoteTick(db, deps);
  if ((await getQuote(db, q.id)).status !== "SENT") await sendQuote(db, admin, deps, q.id);
  const quote = await getQuote(db, q.id);
  expect(quote.status).toBe("SENT");
  return quote;
}

const viewer = () => ({ viewer: { userId: reseller.owner.userId, organisationId: reseller.organisationId, role: reseller.owner.role, name: "Neo Kgosi" } });
const posOf = (orderId: string) => db.purchaseOrder.findMany({ where: { orderId }, include: { lines: { orderBy: { position: "asc" } }, supplier: true }, orderBy: { number: "asc" } });

/** A guest shop order, paid in full by bank transfer. */
async function paidShopOrder(items: { productId: string; quantity: number }[]) {
  const cart = await cartFor(db, undefined);
  for (const i of items) await addToCart(db, cart.id, i, i.quantity);
  const ctx = await priceContext(db, await db.market.findUniqueOrThrow({ where: { code: "bw" } }), "INDIVIDUAL", new Date());
  const input: CheckoutInput = { email: `buyer-${tag().toLowerCase()}@example.co.bw`, name: "Thato Molefe", phone: "+267 71 234 567", fulfilment: "DELIVERY", addressLine1: "Plot 5", addressLine2: "", city: "Gaborone", postalCode: "", collectionPointId: "", paymentMethod: "BANK_TRANSFER", notes: "" };
  const { order } = await placeOrder(db, { key: KEY }, cart.id, ctx, { userId: null, organisationId: null }, input);
  await recordPayment(db, await makeStaff("FINANCE"), { key: KEY }, order.id, { amount: amount(order.totalMinor), reference: "FNB", receivedOn: today() });
  return order;
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  buyer = await makeStaff("PROCUREMENT");
  await setRate(db, admin, "BWP", "13.65");
  await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123" });
  await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
  await updateProcurementRules(db, admin, rules());
  categoryId = (await createCategory(db, admin, { name: `Switching ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
  const supplier = (n: string, o: { email?: string; whatsapp?: string }) =>
    createSupplier(db, admin, { name: `${n} ${tag()}`, kind: "LOCAL", country: "ZA", currency: "USD", email: o.email ?? "", whatsapp: o.whatsapp ?? "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "0", preferred: true, active: true });
  const m = await supplier("Mail Supplier", { email: `po-${tag().toLowerCase()}@example.co.za` });
  mailSupplier = { id: m.id, email: m.email!, name: m.name };
  const c = await supplier("Chat Supplier", { whatsapp: "+27 82 000 0000" });
  chatSupplier = { id: c.id, name: c.name };
  await setSupplierCategories(db, admin, m.id, [categoryId]);
  reseller = await makeOrganisation(`Procure ${tag()}`, "RESELLER");
  await saveBusinessDetails(db, reseller.owner, { name: `Procure ${tag()}`, registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 9, Gaborone", directors: "Neo Kgosi" });
  await addDocument(db, reseller.owner, "REGISTRATION", { name: "reg.pdf", bytes: PDF.bytes });
  await addDocument(db, reseller.owner, "TAX", { name: "tax.pdf", bytes: PDF.bytes });
  await submitForCheck(db, reseller.owner, {});
  await approveOrganisation(db, admin, { key: KEY }, reseller.organisationId);
  await setCreditTerms(db, admin, reseller.organisationId, { limit: "500000", termsDays: "30", onHold: false });
});

describe("purchase order rules", () => {
  const po = (o: Partial<PoForRules> = {}): PoForRules => ({ supplier: { name: "Acme", active: true, preferred: true, email: "a@b.co", whatsapp: null }, currency: "USD", totalBase: 1000_00n, maxValueText: "$2,000.00", ...o });
  const on = { autoSend: true, maxAutoValueMinor: 2000_00n, onlyPreferred: true };

  it("lets a purchase order inside the rules go by itself, and says why any other waits", () => {
    expect(poReviewReasons(on, po())).toEqual([]);
    expect(poReviewReasons({ ...on, autoSend: false }, po())).toEqual(["Sending by itself is switched off."]);
    expect(poReviewReasons(on, po({ totalBase: 2000_01n }))).toEqual(["It is above $2,000.00, the most that goes out by itself."]);
    expect(poReviewReasons(on, po({ totalBase: null, currency: "CNY" }))[0]).toMatch(/no exchange rate for CNY/);
    expect(poReviewReasons(on, po({ supplier: { name: "Acme", active: true, preferred: false, email: "a@b.co", whatsapp: null } }))).toEqual(["Acme isn't a preferred supplier."]);
    expect(poReviewReasons({ ...on, onlyPreferred: false }, po({ supplier: { name: "Acme", active: true, preferred: false, email: "a@b.co", whatsapp: null } }))).toEqual([]);
    expect(poReviewReasons(on, po({ supplier: { name: "Acme", active: false, preferred: true, email: null, whatsapp: null } }))).toHaveLength(2);
  });

  it("reads serial numbers however they are typed", () => {
    expect(readSerials("SN1\nSN2, SN3;SN4\tSN5  SN1\n\n")).toEqual(["SN1", "SN2", "SN3", "SN4", "SN5"]);
    expect(readSerials("  ")).toEqual([]);
  });
});

describe.skipIf(!hasDb)("orders from accepted quotes", () => {
  it("turns a quote accepted on account into an order, and sends its purchase order inside the rules", async () => {
    const a = await product("60.00");
    const q = await sentQuote(`3 x ${a.mpn}`);
    const { order, token } = await acceptQuote(db, deps, q.number, viewer(), take());
    expect(token).toBeTruthy();
    expect(order).toMatchObject({ status: "ON_ACCOUNT", quoteId: q.id, pricesIncludeTax: false, subtotalMinor: q.subtotalMinor, taxMinor: q.taxMinor, totalMinor: q.totalMinor, deliveryMinor: 0n, customerReference: "PO-CUST-9" });
    const lines = await db.orderLine.findMany({ where: { orderId: order.id } });
    expect(lines.map((l) => [l.quantity, l.supplierId, l.supplierCostMinor, l.supplierCurrency])).toEqual([[3, mailSupplier.id, 60_00n, "USD"]]);

    const [po] = await posOf(order.id);
    expect(po).toMatchObject({ status: "SENT", channel: "EMAIL", currency: "USD", totalMinor: 180_00n, supplierId: mailSupplier.id });
    expect(po.number).toMatch(/^PO-\d+$/);
    expect(po.lines.map((l) => [l.quantity, l.unitCostMinor, l.lineTotalMinor])).toEqual([[3, 60_00n, 180_00n]]);
    expect(await db.outboundEmail.count({ where: { toAddress: mailSupplier.email, kind: "supplier.po" } })).toBeGreaterThan(0);

    // Accepting twice, or making the purchase orders twice, does nothing more.
    await expect(acceptQuote(db, deps, q.number, viewer(), take())).rejects.toThrow(/already accepted/);
    expect(await startProcurement(db, deps, order.id)).toEqual([]);
    expect(await db.purchaseOrder.count({ where: { orderId: order.id } })).toBe(1);

    // The supplier sees our order and what we pay them, never the customer or our price.
    const { token: supplierToken } = await lastSecret(mailSupplier.email, "supplier.po");
    const seen = await poByToken(db, supplierToken);
    expect(seen?.number).toBe(po.number);
    const text = JSON.stringify(seen, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain(reseller.email);
    expect(text).not.toContain(order.number);
    expect(text).not.toContain(order.id);
    expect(text).not.toMatch(/Neo Kgosi|orderId|tokenHash|totalBase/);
    expect(text).not.toContain(String(order.totalMinor));
    const pdf = await purchaseOrderPdf(seen!, { appUrl: "https://example.test", legalName: "ICT Distribution", token: supplierToken, deliverTo: "Plot 50", paymentTerms: "30 days", timeZone: "Africa/Gaborone" });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(poLink(po, KEY, "https://example.test")).toContain(`/supplier/po/${supplierToken}`);
  });

  it("waits for payment on a bank transfer, gives a pro forma invoice, and makes purchase orders once paid", async () => {
    const a = await product("40.00");
    const q = await sentQuote(`2 x ${a.mpn}`);
    await expect(acceptQuote(db, deps, q.number, viewer(), take({ paymentMethod: "CARD" }))).rejects.toThrow(/Card payments/);
    await expect(acceptQuote(db, deps, q.number, viewer(), take({ addressLine1: "", city: "" }))).rejects.toMatchObject({ fieldErrors: { addressLine1: expect.any(String), city: expect.any(String) } });
    const { order } = await acceptQuote(db, deps, q.number, viewer(), take({ paymentMethod: "BANK_TRANSFER" }));
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(await db.purchaseOrder.count({ where: { orderId: order.id } })).toBe(0);
    expect(await db.outboundEmail.count({ where: { toAddress: reseller.email, kind: "order.placed" } })).toBeGreaterThan(0);

    const full = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, market: true } });
    const pdf = await proFormaPdf(full, { appUrl: "https://example.test", legalName: "ICT Distribution" });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getTitle()).toBe(`Pro forma invoice ${order.number}`);

    await recordPayment(db, await makeStaff("FINANCE"), { key: KEY }, order.id, { amount: amount(order.totalMinor), reference: "FNB 9", receivedOn: today() });
    expect(await procureWaiting(db, deps)).toBeGreaterThanOrEqual(1);
    const [po] = await posOf(order.id);
    expect(po).toMatchObject({ status: "SENT", totalMinor: 80_00n });
  });

  it("cancels purchase orders not yet with a supplier when the order is cancelled", async () => {
    await updateProcurementRules(db, admin, rules({ autoSend: false }));
    try {
      const a = await product("25.00");
      const { order } = await acceptQuote(db, deps, (await sentQuote(`1 x ${a.mpn}`)).number, viewer(), take());
      const [po] = await posOf(order.id);
      expect(po.status).toBe("AWAITING_APPROVAL");
      expect(po.reviewReasons).toMatch(/switched off/);
      expect(await poByToken(db, "x".repeat(43))).toBeNull();
      expect(await db.outboundEmail.count({ where: { toAddress: buyer.email, kind: "po.to-approve" } })).toBeGreaterThan(0);
      await cancelOrder(db, admin, { key: KEY }, order.id, "The customer changed their mind");
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("CANCELLED");
    } finally {
      await updateProcurementRules(db, admin, rules());
    }
  });
});

describe.skipIf(!hasDb)("purchase orders for shop orders", () => {
  it("makes one per supplier once paid, waits for approval outside the rules, and goes by email or WhatsApp", async () => {
    await updateProcurementRules(db, admin, rules({ maxAutoValue: "10" }));
    try {
      const a = await product("300", mailSupplier.id);
      const b = await product("200", chatSupplier.id);
      const order = await paidShopOrder([
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 2 },
      ]);
      await startProcurement(db, deps, order.id);
      const pos = await posOf(order.id);
      expect(pos.map((p) => [p.supplierId, p.status, p.channel, p.totalMinor])).toEqual(
        expect.arrayContaining([
          [mailSupplier.id, "AWAITING_APPROVAL", "EMAIL", 300_00n],
          [chatSupplier.id, "AWAITING_APPROVAL", "WHATSAPP", 400_00n],
        ]),
      );
      expect(pos.every((p) => /above/.test(p.reviewReasons ?? ""))).toBe(true);
      const mail = pos.find((p) => p.supplierId === mailSupplier.id)!;
      const chat = pos.find((p) => p.supplierId === chatSupplier.id)!;

      await expect(approvePurchaseOrder(db, await makeStaff("SALES"), deps, mail.id)).rejects.toThrow(/role/);
      expect(await approvePurchaseOrder(db, buyer, deps, mail.id)).toBe("SENT");
      await expect(approvePurchaseOrder(db, buyer, deps, mail.id)).rejects.toThrow(/already/);
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: mail.id } })).approvedByLabel).toBe(buyer.name);

      expect(await approvePurchaseOrder(db, buyer, deps, chat.id)).toBe("TO_SEND_BY_HAND");
      const wa = poWhatsappLink(chat, chat.supplier, chat.lines, KEY, "https://example.test");
      expect(wa).toMatch(/^https:\/\/wa\.me\/27820000000\?text=/);
      expect(decodeURIComponent(wa!)).toContain(chat.number);
      await markPoSentByHand(db, buyer, deps, chat.id);
      await markPoReceived(db, buyer, deps, chat.id);
      expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: chat.id } })).status).toBe("RECEIVED");
      await expect(cancelPurchaseOrder(db, buyer, deps, chat.id, "Too late")).rejects.toThrow(/can't be cancelled/);

      await expect(cancelPurchaseOrder(db, buyer, deps, mail.id, "")).rejects.toThrow(/Say why/);
      await cancelPurchaseOrder(db, buyer, deps, mail.id, "Found it cheaper");
      expect(await db.outboundEmail.count({ where: { toAddress: mailSupplier.email, kind: "supplier.po-cancelled" } })).toBeGreaterThan(0);
    } finally {
      await updateProcurementRules(db, admin, rules());
    }
  });

  it("lets the supplier confirm, ship with serial numbers and send their invoice by the link", async () => {
    const a = await product("90");
    const order = await paidShopOrder([{ productId: a.id, quantity: 2 }]);
    await startProcurement(db, deps, order.id);
    const [po] = await posOf(order.id);
    expect(po.status).toBe("SENT");
    const { token } = await lastSecret(mailSupplier.email, "supplier.po");
    const line = po.lines[0];

    await expect(confirmPurchaseOrder(db, deps, { token: "wrong" }, { supplierReference: "", expectedShipDate: inDays(3), note: "", lines: [] })).rejects.toThrow(/link doesn't work/);
    await expect(confirmPurchaseOrder(db, deps, { token }, { supplierReference: "SO-1", expectedShipDate: "soon", note: "", lines: [{ lineId: line.id, confirmedQuantity: "5", shipDate: "", note: "" }] })).rejects.toMatchObject({ fieldErrors: { expectedShipDate: expect.any(String), [`qty-${line.id}`]: expect.any(String) } });
    await confirmPurchaseOrder(db, deps, { token }, { supplierReference: "SO-1", expectedShipDate: inDays(3), note: "One now, one next week", lines: [{ lineId: line.id, confirmedQuantity: "1", shipDate: inDays(10), note: "Back order" }] });
    let now = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    expect(now).toMatchObject({ status: "CONFIRMED", supplierReference: "SO-1", supplierNote: "One now, one next week" });
    expect(now.lines[0]).toMatchObject({ confirmedQuantity: 1, note: "Back order" });
    expect(await db.outboundEmail.count({ where: { toAddress: buyer.email, kind: "po.updated", payload: { path: ["number"], equals: po.number } } })).toBe(1);

    await expect(shipPurchaseOrder(db, deps, { token }, { shippedOn: today(), shippingReference: "WB-1", lines: [{ lineId: line.id, serials: "SN-A, SN-B" }] })).rejects.toMatchObject({ fieldErrors: { [`serials-${line.id}`]: expect.stringMatching(/2 serial numbers for 1 unit/) } });
    await expect(shipPurchaseOrder(db, deps, { token }, { shippedOn: inDays(5), shippingReference: "", lines: [] })).rejects.toMatchObject({ fieldErrors: { shippedOn: expect.any(String) } });
    await shipPurchaseOrder(db, deps, { token }, { shippedOn: today(), shippingReference: "WB-1", lines: [{ lineId: line.id, serials: "SN-A" }] });
    now = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    expect(now).toMatchObject({ status: "SHIPPED", shippingReference: "WB-1" });
    expect(now.lines[0].serials).toBe("SN-A");
    await expect(confirmPurchaseOrder(db, deps, { token }, { supplierReference: "", expectedShipDate: inDays(3), note: "", lines: [] })).rejects.toThrow(/shipped/);

    await expect(addPoDocument(db, deps, { token }, "INVOICE", { name: "invoice.exe", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]) })).rejects.toThrow(/PDF/);
    await expect(addPoDocument(db, deps, { token }, "RECEIPT", PDF)).rejects.toThrow(/what it is/);
    await addPoDocument(db, deps, { token }, "INVOICE", PDF);
    await addPoDocument(db, deps, { actor: buyer, id: po.id }, "PACKING_LIST", { name: "packing.csv", bytes: new Uint8Array(Buffer.from("item,qty\nswitch,1\n")) });
    const docs = await db.purchaseOrderDocument.findMany({ where: { purchaseOrderId: po.id }, orderBy: { createdAt: "asc" } });
    expect(docs.map((d) => [d.kind, d.contentType, d.uploadedByLabel])).toEqual([
      ["INVOICE", "application/pdf", mailSupplier.name],
      ["PACKING_LIST", "text/csv", buyer.name],
    ]);
    expect((await readPoDocument(db, docs[0].id, { token })).filename).toBe("invoice.pdf");
    await expect(readPoDocument(db, docs[0].id, { token: "wrong" })).rejects.toThrow(/No such file/);
    await expect(readPoDocument(db, docs[0].id, { actor: await makeStaff("SALES") })).resolves.toBeTruthy();

    await markPoReceived(db, buyer, deps, po.id);
    const actions = (await db.auditEvent.findMany({ where: { targetId: po.id }, select: { action: true } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["po.created", "po.confirmed", "po.shipped", "po.document", "po.received"]));
  });

  it("leaves a line nobody supplies for staff, and only Admin changes the rules", async () => {
    const mpn = `NOSUP1${tag()}`;
    const p = await createProduct(db, admin, { name: `Cable ${mpn}`, brand: "Generic", mpn, categoryId, summary: "", description: "", warrantyMonths: "", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null });
    await saveOffer(db, admin, { supplierId: mailSupplier.id, productId: p.id, cost: "5", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    const order = await paidShopOrder([{ productId: p.id, quantity: 1 }]);
    await saveOffer(db, admin, { supplierId: mailSupplier.id, productId: p.id, cost: "5", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: false });
    expect(await startProcurement(db, deps, order.id)).toEqual([]);
    expect(await db.outboundEmail.count({ where: { toAddress: buyer.email, kind: "po.to-approve", payload: { path: ["orderId"], equals: order.id } } })).toBe(1);

    await expect(updateProcurementRules(db, buyer, rules())).rejects.toThrow(/role/);
    await expect(updateProcurementRules(db, admin, rules({ maxAutoValue: "lots" }))).rejects.toMatchObject({ fieldErrors: { maxAutoValue: expect.any(String) } });
  });
});
