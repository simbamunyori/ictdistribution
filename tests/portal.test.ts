import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applyForCredit, decideCredit } from "../src/server/accounts/credit";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { ageing, buildStatement, invoiceState, type StatementItem } from "../src/lib/statement";
import { dispatchDelivery, prepareDelivery } from "../src/server/logistics/deliveries";
import { customerPayments, customerStatement, statementPdf } from "../src/server/portal/accounts";
import { customerInvoices, invoiceByToken, invoiceForViewer, invoicePdf, issueInvoice } from "../src/server/portal/invoices";
import { createList, deleteList, getList, listsFor, listToCart, reorder, saveOrderAsList, saveToList, setListLine } from "../src/server/portal/lists";
import { customerDeliveries, itemsOnTheWay, portalSummary } from "../src/server/portal/overview";
import { advanceReturn, customerReturns, requestReturn, returnableLines, withdrawReturn } from "../src/server/portal/returns";
import { portalCan, type PortalViewer } from "../src/server/portal/scope";
import { setRate } from "../src/server/pricing/rates";
import { addToCart, cartFor, cartLines } from "../src/server/shop/cart";
import { fulfilOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext } from "../src/server/shop/prices";
import { updateMarketDelivery, updateMarketTaxAndBank, updateShopSettings } from "../src/server/shop/settings";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { addMember, db, hasDb, KEY, lastSecret, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const amount = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("statements", () => {
  const item = (date: string, kind: StatementItem["kind"], amountMinor: bigint, reference = "X"): StatementItem => ({ date: d(date), kind, reference, details: "", amountMinor });

  it("carries the balance in, runs it line by line and totals the period", () => {
    const st = buildStatement([item("2026-01-10", "invoice", 1000_00n), item("2026-01-20", "payment", 400_00n), item("2026-02-03", "payment", 600_00n), item("2026-02-03", "invoice", 250_00n), item("2026-03-01", "invoice", 99_00n)], d("2026-02-01"), d("2026-02-28"));
    expect(st.opening).toBe(600_00n);
    // The invoice comes before the payment on the same day.
    expect(st.entries.map((e) => [e.kind, e.balance])).toEqual([
      ["invoice", 850_00n],
      ["payment", 250_00n],
    ]);
    expect(st).toMatchObject({ invoiced: 250_00n, paid: 600_00n, closing: 250_00n });
  });

  it("ages what is owed by days past due", () => {
    const at = d("2026-06-30");
    const a = ageing(
      [
        { dueAt: d("2026-07-15"), outstandingMinor: 1n },
        { dueAt: d("2026-06-10"), outstandingMinor: 20n },
        { dueAt: d("2026-05-15"), outstandingMinor: 300n },
        { dueAt: d("2026-04-10"), outstandingMinor: 4000n },
        { dueAt: d("2026-01-01"), outstandingMinor: 50000n },
        { dueAt: d("2026-01-01"), outstandingMinor: 0n },
      ],
      at,
    );
    expect(a).toEqual({ current: 1n, days30: 20n, days60: 300n, days90: 4000n, older: 50000n, total: 54321n });
    expect(invoiceState(100n, 100n, d("2026-01-01"), at)).toBe("PAID");
    expect(invoiceState(100n, 50n, d("2026-01-01"), at)).toBe("OVERDUE");
    expect(invoiceState(100n, 0n, d("2026-07-01"), at)).toBe("DUE");
  });
});

describe.skipIf(!hasDb)("customer portal", () => {
  let admin: Awaited<ReturnType<typeof makeStaff>>;
  let categoryId: string;
  let supplierId: string;

  async function product(name = "Switch") {
    const mpn = `PT${tag()}`;
    const p = await createProduct(db, admin, { name: `${name} ${mpn}`, brand: "Ubiquiti", mpn, categoryId, summary: "", description: "", warrantyMonths: "12", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null });
    await saveOffer(db, admin, { supplierId, productId: p.id, cost: "100.00", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    return p;
  }

  const PDF = { name: "certificate.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")) };

  /** A business with credit, and a viewer for its owner. */
  async function business() {
    const org = await makeOrganisation(`Portal ${tag()}`);
    await saveBusinessDetails(db, org.owner, { name: `Portal ${tag()}`, registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 42, Mogoditshane", directors: "Neo Kgosi" });
    await addDocument(db, org.owner, "REGISTRATION", PDF);
    await addDocument(db, org.owner, "TAX", PDF);
    await submitForCheck(db, org.owner, {});
    await approveOrganisation(db, admin, { key: KEY }, org.organisationId);
    await applyForCredit(db, org.owner, { limit: "100000", termsDays: "30", details: "We spend about P20,000 a month with two trade references." });
    const app = await db.creditApplication.findFirstOrThrow({ where: { organisationId: org.organisationId, status: "PENDING" } });
    await decideCredit(db, admin, { key: KEY }, app.id, { approve: true, limit: "100000", termsDays: "30", note: "" });
    const owner: PortalViewer = { userId: org.owner.userId, name: org.owner.name, email: org.email, organisationId: org.organisationId, role: "OWNER" };
    return { org, owner };
  }

  const as = (m: Awaited<ReturnType<typeof addMember>>): PortalViewer => ({ userId: m.userId, name: m.name, email: `${m.role.toLowerCase()}@example.co.bw`, organisationId: m.organisationId, role: m.role });

  const checkout = (o: Partial<CheckoutInput> = {}): CheckoutInput => ({ email: `pt-${tag().toLowerCase()}@example.co.bw`, name: "Neo Kgosi", phone: "+267 71 234 567", fulfilment: "DELIVERY", addressLine1: "Plot 42", addressLine2: "", city: "Mogoditshane", postalCode: "", collectionPointId: "", paymentMethod: "ACCOUNT", notes: "", customerReference: "PO-1", ...o });

  async function orderFor(v: PortalViewer, items: { productId: string; quantity: number }[], o: Partial<CheckoutInput> = {}, now?: Date) {
    const cart = await cartFor(db, undefined);
    for (const i of items) await addToCart(db, cart.id, i, i.quantity, { trade: Boolean(v.organisationId) });
    const ctx = await priceContext(db, await db.market.findUniqueOrThrow({ where: { code: "bw" } }), v.organisationId ? "BUSINESS" : "INDIVIDUAL", new Date(), v.organisationId);
    const { order } = await placeOrder(db, { key: KEY, now }, cart.id, ctx, { userId: v.userId, organisationId: v.organisationId, role: v.role }, checkout(o));
    return order;
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await makeStaff("ADMIN");
    await setRate(db, admin, "BWP", "13.65");
    await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123", taxNumber: "P03000000000" });
    await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
    categoryId = (await createCategory(db, admin, { name: `Portal kit ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
    supplierId = (await createSupplier(db, admin, { name: `Portal supplier ${tag()}`, kind: "LOCAL", country: "BW", currency: "BWP", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "0", preferred: false, active: true })).id;
  });

  it("issues one tax invoice when an order is sent, emails its link and shows it to the whole team", async () => {
    const { org, owner } = await business();
    const p = await product();
    const order = await orderFor(owner, [{ productId: p.id, quantity: 2 }]);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(0);
    await fulfilOrder(db, admin, { key: KEY }, order.id, "");
    const inv = await db.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(inv).toMatchObject({ number: expect.stringMatching(/^INV-\d+$/), organisationId: org.organisationId, totalMinor: order.totalMinor, taxNumber: "C01234567890" });
    expect(inv.dueAt.getTime()).toBe(order.payBy!.getTime());
    expect(inv.billTo).toMatch(/^Portal .*\nAttention: Neo Kgosi\nPlot 42, Mogoditshane/);
    expect(await db.$transaction((tx) => issueInvoice(tx, KEY, order.id, new Date()))).toBe(inv.number);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(1);

    const { token } = await lastSecret(order.email, "invoice.issued");
    expect((await invoiceByToken(db, inv.number, token))?.id).toBe(inv.id);
    expect(await invoiceByToken(db, inv.number, "wrong")).toBeNull();
    const viewer = as(await addMember(org.organisationId, "VIEWER"));
    expect((await invoiceForViewer(db, inv.number, viewer))?.id).toBe(inv.id);
    expect(await invoiceForViewer(db, inv.number, (await business()).owner)).toBeNull();
    expect(await invoiceForViewer(db, inv.number, { userId: owner.userId, organisationId: null })).toBeNull();

    const listed = await customerInvoices(db, viewer);
    expect(listed.map((i) => [i.number, i.state, i.outstanding])).toEqual([[inv.number, "DUE", order.totalMinor]]);
    const pdf = await PDFDocument.load(await invoicePdf((await invoiceByToken(db, inv.number, token))!, { appUrl: "http://localhost:3000", legalName: "ICT Distribution Africa" }));
    expect(pdf.getTitle()).toBe(`Tax invoice ${inv.number}`);
  });

  it("issues the invoice when a delivery takes the last of an order, already paid by bank transfer", async () => {
    const v: PortalViewer = { userId: (await db.user.create({ data: { email: `ind-${tag().toLowerCase()}@example.co.bw`, name: "Kagiso Moeng", emailVerifiedAt: new Date() } })).id, name: "Kagiso Moeng", email: "k@example.co.bw", organisationId: null, role: null };
    const p = await product("Camera");
    const order = await orderFor(v, [{ productId: p.id, quantity: 1 }], { paymentMethod: "BANK_TRANSFER" });
    await recordPayment(db, admin, { key: KEY }, order.id, { amount: amount(order.totalMinor), reference: "EFT 1", receivedOn: today() });
    const line = await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
    const dn = await prepareDelivery(db, admin, order.id, { quantities: { [line.id]: "1" }, carrier: "", reference: "" });
    await dispatchDelivery(db, admin, { key: KEY }, dn.id, { carrier: "Courier Guy", reference: "CG7" });
    const [inv] = await customerInvoices(db, v);
    expect(inv).toMatchObject({ orderId: order.id, state: "PAID", outstanding: 0n, userId: v.userId, organisationId: null });
    expect((await customerPayments(db, v)).map((x) => x.order.number)).toEqual([order.number]);
    expect((await customerDeliveries(db, v)).map((x) => [x.number, x.status])).toEqual([[dn.number, "DISPATCHED"]]);
    expect((await itemsOnTheWay(db, v)).map((x) => x.tracking)).toEqual(["OUT_FOR_DELIVERY"]);
  });

  it("states the account with payments and what is owed by age, for the roles that may see it", async () => {
    const { org, owner } = await business();
    const p = await product("Router");
    const start = new Date(Date.now() - 110 * DAY);
    const first = await orderFor(owner, [{ productId: p.id, quantity: 1 }], {}, start);
    await fulfilOrder(db, admin, { key: KEY, now: start }, first.id, "");
    const second = await orderFor(owner, [{ productId: p.id, quantity: 3 }]);
    await fulfilOrder(db, admin, { key: KEY }, second.id, "");
    await recordPayment(db, admin, { key: KEY }, second.id, { amount: amount(second.totalMinor / 3n), reference: "Part", receivedOn: today() });
    const now = new Date();
    const st = await customerStatement(db, owner, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + DAY));
    expect(st.accounts).toHaveLength(1);
    const a = st.accounts[0];
    expect(a.opening).toBe(first.totalMinor);
    expect(a.entries.map((e) => e.kind)).toEqual(["invoice", "payment"]);
    expect(a.closing).toBe(first.totalMinor + second.totalMinor - second.totalMinor / 3n);
    expect(a.ageing).toMatchObject({ current: second.totalMinor - second.totalMinor / 3n, days90: first.totalMinor, total: a.closing });
    expect((await portalSummary(db, owner)).owed).toEqual([{ currency: "BWP", owed: a.closing, overdue: first.totalMinor, locale: "en-BW" }]);
    expect((await PDFDocument.load(await statementPdf(st, { appUrl: "http://localhost:3000", legalName: "ICT Distribution Africa" }))).getPageCount()).toBe(1);

    expect(portalCan(as(await addMember(org.organisationId, "FINANCE")), "accounts")).toBe(true);
    expect(portalCan(as(await addMember(org.organisationId, "VIEWER")), "accounts")).toBe(true);
    expect(portalCan(as(await addMember(org.organisationId, "BUYER")), "accounts")).toBe(false);
    expect(portalCan({ role: null }, "accounts")).toBe(true);
  });

  it("takes returns for what was sent, within the window unless faulty, and settles them step by step", async () => {
    const { org, owner } = await business();
    const p = await product("Access point");
    const order = await orderFor(owner, [{ productId: p.id, quantity: 3 }]);
    const lineId = (await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } })).id;
    const input = (qty: string, reason = "NOT_NEEDED") => ({ reason, details: "Ordered one too many.", quantities: { [lineId]: qty } });
    await expect(requestReturn(db, { key: KEY }, owner, order.number, input("1"))).rejects.toMatchObject({ fieldErrors: { [`qty-${lineId}`]: "Nothing of this line can be returned." } });
    await fulfilOrder(db, admin, { key: KEY }, order.id, "");
    await expect(requestReturn(db, { key: KEY }, as(await addMember(org.organisationId, "VIEWER")), order.number, input("1"))).rejects.toThrow(/Owner or a Buyer/);
    await expect(requestReturn(db, { key: KEY }, (await business()).owner, order.number, input("1"))).rejects.toThrow(/No such order/);
    await expect(requestReturn(db, { key: KEY }, owner, order.number, input("4"))).rejects.toMatchObject({ fieldErrors: { [`qty-${lineId}`]: "Enter up to 3." } });

    const buyer = as(await addMember(org.organisationId, "BUYER"));
    const r = await requestReturn(db, { key: KEY }, buyer, order.number, input("2"));
    expect(r).toMatchObject({ number: expect.stringMatching(/^RMA-\d+$/), status: "REQUESTED", organisationId: org.organisationId });
    expect(await db.outboundEmail.count({ where: { kind: "return.requested", toAddress: buyer.email } })).toBe(1);
    expect((await returnableLines(db, order.id)).lines[0]).toMatchObject({ sent: 3, returned: 2, available: 1 });

    // A change of mind after the window is refused; a fault is not.
    const late = { key: KEY, now: new Date(Date.now() + 30 * DAY) };
    await expect(requestReturn(db, late, owner, order.number, input("1"))).rejects.toThrow(/within 14 days/);
    const faulty = await requestReturn(db, late, owner, order.number, input("1", "FAULTY"));
    await withdrawReturn(db, owner, faulty.number);
    await expect(withdrawReturn(db, owner, faulty.number)).rejects.toThrow(/already answered/);

    await expect(advanceReturn(db, await makeStaff("FINANCE"), { key: KEY }, r.id, "approve", "")).rejects.toThrow(/role/);
    await expect(advanceReturn(db, admin, { key: KEY }, r.id, "receive", "")).rejects.toThrow(/can't be received/);
    await advanceReturn(db, admin, { key: KEY }, r.id, "approve", "Drop them at our Gaborone West office.");
    await advanceReturn(db, admin, { key: KEY }, r.id, "receive", "");
    await expect(advanceReturn(db, admin, { key: KEY }, r.id, "close", "")).rejects.toMatchObject({ field: "note" });
    await advanceReturn(db, admin, { key: KEY }, r.id, "close", "Refunded to your account.");
    const done = (await customerReturns(db, owner)).find((x) => x.id === r.id)!;
    expect(done).toMatchObject({ status: "CLOSED", note: "Refunded to your account.", decidedByLabel: admin.name });
    expect(await db.outboundEmail.count({ where: { kind: { in: ["return.approved", "return.received", "return.closed"] }, toAddress: (await db.user.findUniqueOrThrow({ where: { id: buyer.userId } })).email } })).toBe(3);
    expect((await portalSummary(db, owner)).returns).toBe(0);
  });

  it("keeps saved lists for the team, puts them in the cart and buys an order again", async () => {
    const { org, owner } = await business();
    const [a, b] = [await product("Laptop"), await product("Dock")];
    const list = await saveToList(db, owner, { newName: "Monthly office kit" }, a.id, "2");
    await saveToList(db, owner, { listId: list.id }, a.id, 3);
    await saveToList(db, owner, { listId: list.id }, b.id, "1");
    const viewer = as(await addMember(org.organisationId, "VIEWER"));
    expect((await listsFor(db, viewer)).map((l) => [l.name, l._count.lines])).toEqual([["Monthly office kit", 2]]);
    expect((await getList(db, viewer, list.id))?.lines.map((l) => l.quantity)).toEqual([5, 1]);
    await expect(createList(db, viewer, "Mine")).rejects.toThrow(/Owner or a Buyer/);
    expect(await getList(db, (await business()).owner, list.id)).toBeNull();
    expect(await listsFor(db, { userId: owner.userId, organisationId: null })).toEqual([]);
    await expect(saveToList(db, owner, { listId: list.id }, a.id, "0")).rejects.toMatchObject({ field: "quantity" });

    const cart = await cartFor(db, undefined);
    await db.product.update({ where: { id: b.id }, data: { status: "ARCHIVED" } });
    const put = await listToCart(db, owner, list.id, cart.id, { trade: true });
    expect(put.added).toBe(1);
    expect(put.skipped).toEqual([expect.stringMatching(/^Ubiquiti Dock .*isn't in the shop any more/)]);
    expect((await cartLines(db, cart.id)).map((l) => [l.productId, l.quantity])).toEqual([[a.id, 5]]);

    const lineId = (await getList(db, owner, list.id))!.lines[1].id;
    await setListLine(db, owner, lineId, "0");
    expect((await getList(db, owner, list.id))!.lines).toHaveLength(1);

    await db.product.update({ where: { id: b.id }, data: { status: "ACTIVE" } });
    const order = await orderFor(owner, [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 4 }]);
    const copy = await saveOrderAsList(db, owner, order.number, "From the last order");
    expect((await getList(db, owner, copy.id))!.lines.map((l) => l.quantity)).toEqual([1, 4]);
    const again = await cartFor(db, undefined);
    expect(await reorder(db, owner, order.number, again.id, { trade: true })).toEqual({ added: 2, skipped: [] });
    expect((await cartLines(db, again.id)).map((l) => l.quantity).sort()).toEqual([1, 4]);
    await expect(reorder(db, as(await addMember(org.organisationId, "FINANCE")), order.number, again.id, { trade: true })).rejects.toThrow(/Owner or a Buyer/);
    await deleteList(db, owner, copy.id);
    expect(await listsFor(db, owner)).toHaveLength(1);
  });

  it("sets the return window in the shop settings", async () => {
    await expect(updateShopSettings(db, admin, { heroTitle: "ICT for work and home", heroText: "", payDays: "3", maxLineQuantity: "10", returnDays: "-1" })).rejects.toMatchObject({ fieldErrors: { returnDays: expect.any(String) } });
    await updateShopSettings(db, admin, { heroTitle: "ICT for work and home, delivered across Southern Africa", heroText: "Laptops, phones, monitors and the rest, at clear prices. Businesses get trade pricing and quotes.", payDays: "3", maxLineQuantity: "10", returnDays: "14" });
    expect((await db.shopSettings.findUniqueOrThrow({ where: { id: "global" } })).returnDays).toBe(14);
  });
});
