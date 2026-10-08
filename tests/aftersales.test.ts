import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStatement, type StatementItem } from "../src/lib/statement";
import { serialKey, warrantyEnd, warrantyState } from "../src/lib/warranty";
import { accountBalance, applyForCredit, decideCredit } from "../src/server/accounts/credit";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { creditFor, creditNoteByToken, creditNotePdf, moneyFor, orderMoney, recordRefund } from "../src/server/aftersales/credit-notes";
import { customerUnits, findUnits, setLineSerials } from "../src/server/aftersales/units";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { customerStatement } from "../src/server/portal/accounts";
import { customerInvoices } from "../src/server/portal/invoices";
import { advanceReturn, customerReturn, requestReturn, returnableLines, setInboundTracking } from "../src/server/portal/returns";
import type { PortalViewer } from "../src/server/portal/scope";
import { setRate } from "../src/server/pricing/rates";
import { addToCart, cartFor } from "../src/server/shop/cart";
import { fulfilOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext } from "../src/server/shop/prices";
import { updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, lastSecret, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const DAY = 86_400_000;
const d = (s: string) => new Date(`${s}T12:00:00Z`);
const amount = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

describe("warranty and credit sums", () => {
  it("matches serial numbers however they are typed", () => {
    expect(serialKey(" ab-12.3/x y ")).toBe("AB123XY");
  });

  it("ends a warranty its months later, at the end of a shorter month", () => {
    expect(warrantyEnd(d("2026-01-15"), 12)?.toISOString()).toBe("2027-01-15T11:59:59.999Z");
    expect(warrantyEnd(d("2026-01-31"), 1)?.toISOString()).toBe("2026-02-28T11:59:59.999Z");
    expect(warrantyEnd(d("2026-01-31"), null)).toBeNull();
    const u = { startsAt: d("2026-01-15"), endsAt: warrantyEnd(d("2026-01-15"), 12), warrantyMonths: 12 };
    expect(warrantyState(u, d("2026-06-01"))).toBe("IN_WARRANTY");
    expect(warrantyState(u, d("2027-01-16"))).toBe("ENDED");
    expect(warrantyState({ startsAt: null, endsAt: null, warrantyMonths: 12 }, d("2026-06-01"))).toBe("NOT_SENT");
  });

  it("credits at the prices charged, with tax worked out as the invoice did", () => {
    const item = { description: "Switch", mpn: "S1", quantity: 2, unitPriceMinor: 114_00n };
    expect(creditFor({ pricesIncludeTax: true, taxRateBps: 1400 }, [item])).toMatchObject({ totalMinor: 228_00n, taxMinor: 28_00n });
    expect(creditFor({ pricesIncludeTax: false, taxRateBps: 1400 }, [item])).toMatchObject({ totalMinor: 259_92n, taxMinor: 31_92n });
  });

  it("owes what is left after credits, and pays back what was paid beyond it", () => {
    expect(orderMoney(1000n, [{ amountMinor: 1000n }], [{ totalMinor: 300n }], [])).toMatchObject({ due: 700n, outstanding: 0n, overpaid: 300n });
    expect(orderMoney(1000n, [{ amountMinor: 1000n }], [{ totalMinor: 300n }], [{ amountMinor: 300n }])).toMatchObject({ outstanding: 0n, overpaid: 0n });
    expect(orderMoney(1000n, [{ amountMinor: 200n }], [{ totalMinor: 300n }], [])).toMatchObject({ outstanding: 500n, overpaid: 0n });
  });

  it("puts credit notes and refunds on the statement", () => {
    const item = (date: string, kind: StatementItem["kind"], amountMinor: bigint): StatementItem => ({ date: d(date), kind, reference: kind, details: "", amountMinor });
    const st = buildStatement([item("2026-03-01", "invoice", 1000n), item("2026-03-02", "payment", 1000n), item("2026-03-05", "credit", 300n), item("2026-03-06", "refund", 300n)], d("2026-03-01"), d("2026-03-31"));
    expect(st.entries.map((e) => [e.kind, e.debit, e.credit, e.balance])).toEqual([
      ["invoice", 1000n, 0n, 1000n],
      ["payment", 0n, 1000n, 0n],
      ["credit", 0n, 300n, -300n],
      ["refund", 300n, 0n, 0n],
    ]);
  });
});

describe.skipIf(!hasDb)("after-sales", () => {
  let admin: Awaited<ReturnType<typeof makeStaff>>;
  let categoryId: string;
  let supplierId: string;

  async function product(name = "Router") {
    const mpn = `AS${tag()}`;
    const p = await createProduct(db, admin, { name: `${name} ${mpn}`, brand: "MikroTik", mpn, categoryId, summary: "", description: "", warrantyMonths: "12", warrantyTerms: "Maker, carry-in", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null });
    await saveOffer(db, admin, { supplierId, productId: p.id, cost: "100.00", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    return p;
  }

  const PDF = { name: "certificate.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")) };

  async function business() {
    const org = await makeOrganisation(`After ${tag()}`);
    await saveBusinessDetails(db, org.owner, { name: `After ${tag()}`, registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 7, Broadhurst", directors: "Mpho Dube" });
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

  const checkout = (): CheckoutInput => ({ email: `as-${tag().toLowerCase()}@example.co.bw`, name: "Mpho Dube", phone: "+267 71 234 567", fulfilment: "DELIVERY", addressLine1: "Plot 7", addressLine2: "", city: "Gaborone", postalCode: "", collectionPointId: "", paymentMethod: "ACCOUNT", notes: "", customerReference: "PO-9" });

  async function orderFor(v: PortalViewer, productId: string, quantity: number) {
    const cart = await cartFor(db, undefined);
    await addToCart(db, cart.id, { productId }, quantity, { trade: true });
    const ctx = await priceContext(db, await db.market.findUniqueOrThrow({ where: { code: "bw" } }), "BUSINESS", new Date(), v.organisationId);
    return (await placeOrder(db, { key: KEY }, cart.id, ctx, { userId: v.userId, organisationId: v.organisationId, role: v.role }, checkout())).order;
  }

  /** An order of `quantity` serial-numbered units, sent, with its serials. */
  async function sold(quantity: number) {
    const b = await business();
    const p = await product();
    const order = await orderFor(b.owner, p.id, quantity);
    const line = await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
    const serials = Array.from({ length: quantity }, () => `SN-${tag()}`);
    await setLineSerials(db, admin, line.id, serials.join("\n"));
    await fulfilOrder(db, admin, { key: KEY }, order.id, "");
    const units = await db.unit.findMany({ where: { orderId: order.id }, orderBy: { serial: "asc" } });
    return { ...b, order, line, serials, units };
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await makeStaff("ADMIN");
    await setRate(db, admin, "BWP", "13.65");
    await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123", taxNumber: "P03000000000" });
    await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
    categoryId = (await createCategory(db, admin, { name: `After kit ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
    supplierId = (await createSupplier(db, admin, { name: `After supplier ${tag()}`, kind: "LOCAL", country: "BW", currency: "BWP", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "0", preferred: false, active: true })).id;
  });

  it("records serials, starts each warranty when it leaves us and finds them however typed", async () => {
    const { owner } = await business();
    const p = await product();
    const order = await orderFor(owner, p.id, 2);
    const line = await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(setLineSerials(db, admin, line.id, "A1\nA2\nA3")).rejects.toMatchObject({ field: "serials" });
    await expect(setLineSerials(db, await makeStaff("FINANCE"), line.id, "A1")).rejects.toThrow(/role/);
    const s1 = `zx-${tag()}-01`;
    await setLineSerials(db, admin, line.id, `${s1}\nZX${tag()}02`);
    const before = await db.unit.findMany({ where: { orderId: order.id } });
    expect(before).toHaveLength(2);
    expect(before.every((u) => u.startsAt === null && u.warrantyMonths === 12 && u.warrantyTerms === "Maker, carry-in")).toBe(true);
    // Changing the list drops what was removed and keeps the rest.
    await setLineSerials(db, admin, line.id, s1);
    expect(await db.unit.count({ where: { orderId: order.id } })).toBe(1);

    await fulfilOrder(db, admin, { key: KEY }, order.id, "");
    const [u] = await db.unit.findMany({ where: { orderId: order.id } });
    expect(u.startsAt).not.toBeNull();
    expect(u.endsAt!.getTime()).toBe(warrantyEnd(u.startsAt!, 12)!.getTime());
    expect((await customerUnits(db, owner)).map((x) => x.id)).toContain(u.id);
    expect(await customerUnits(db, (await business()).owner)).toHaveLength(0);
    expect((await findUnits(db, s1.toUpperCase().replace(/-/g, " "))).map((x) => x.id)).toEqual([u.id]);
  });

  it("replaces a faulty unit under a return, carrying on its warranty", async () => {
    const fresh = await sold(1);
    const input = { reason: "FAULTY", wants: "REPLACEMENT", details: "It reboots every few minutes.", quantities: {}, units: [fresh.units[0].id] };
    await expect(requestReturn(db, { key: KEY }, (await business()).owner, fresh.order.number, input)).rejects.toThrow(/No such order/);
    await expect(requestReturn(db, { key: KEY }, fresh.owner, fresh.order.number, { ...input, wants: "" })).rejects.toMatchObject({ fieldErrors: { wants: expect.any(String) } });
    const r = await requestReturn(db, { key: KEY }, fresh.owner, fresh.order.number, input);
    expect(r.wants).toBe("REPLACEMENT");
    expect((await returnableLines(db, fresh.order.id)).lines[0].units).toHaveLength(0);
    await expect(requestReturn(db, { key: KEY }, fresh.owner, fresh.order.number, input)).rejects.toThrow(/Enter how many/);

    await expect(setInboundTracking(db, fresh.owner, r.number, { carrier: "Courier", reference: "T1" })).rejects.toThrow(/on their way/);
    await advanceReturn(db, admin, { key: KEY }, r.id, "approve", { note: "" });
    await setInboundTracking(db, fresh.owner, r.number, { carrier: "Kwik Courier", reference: "KC123" });
    await advanceReturn(db, admin, { key: KEY }, r.id, "receive", { note: "" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: fresh.units[0].id } })).status).toBe("IN_REPAIR");
    await expect(advanceReturn(db, admin, { key: KEY }, r.id, "replace", { note: "", reference: "OUT1", replacements: {} })).rejects.toMatchObject({ fieldErrors: { [`replace-${fresh.units[0].id}`]: expect.stringMatching(/serial number/) } });
    await expect(advanceReturn(db, admin, { key: KEY }, r.id, "replace", { note: "", replacements: { [fresh.units[0].id]: "NEW1" } })).rejects.toMatchObject({ field: "reference" });
    const newSerial = `NEW-${tag()}`;
    await advanceReturn(db, admin, { key: KEY }, r.id, "replace", { note: "", carrier: "Kwik Courier", reference: "KC999", replacements: { [fresh.units[0].id]: newSerial } });
    const old = await db.unit.findUniqueOrThrow({ where: { id: fresh.units[0].id }, include: { replacedBy: true } });
    expect(old.status).toBe("REPLACED");
    expect(old.replacedBy).toMatchObject({ serial: newSerial, source: "replacement", status: "WITH_CUSTOMER", endsAt: old.endsAt });
    const seen = await customerReturn(db, fresh.owner, r.number);
    expect(seen).toMatchObject({ status: "CLOSED", outcome: "REPLACEMENT", inboundReference: "KC123", outboundReference: "KC999" });
    expect(await db.outboundEmail.count({ where: { kind: "return.replaced", toAddress: fresh.owner.email } })).toBe(1);
  });

  it("repairs and sends back, keeping the repairer's reference from the customer", async () => {
    const { owner, order, units } = await sold(1);
    const r = await requestReturn(db, { key: KEY }, owner, order.number, { reason: "FAULTY", wants: "REPAIR", details: "Port 3 is dead.", quantities: {}, units: [units[0].id] });
    await advanceReturn(db, admin, { key: KEY }, r.id, "approve", { note: "" });
    await advanceReturn(db, admin, { key: KEY }, r.id, "receive", { note: "" });
    await advanceReturn(db, admin, { key: KEY }, r.id, "repair", { note: "With the maker's service centre.", supplierReference: "MT-RMA-5521" });
    const email = await db.outboundEmail.findFirstOrThrow({ where: { kind: "return.repairing", toAddress: owner.email } });
    expect(JSON.stringify(email.payload)).not.toContain("MT-RMA-5521");
    await advanceReturn(db, admin, { key: KEY }, r.id, "repaired", { note: "Port replaced.", carrier: "Kwik Courier", reference: "KC1" });
    expect(await db.unit.findUniqueOrThrow({ where: { id: units[0].id } })).toMatchObject({ status: "WITH_CUSTOMER" });
    expect(await db.returnRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "CLOSED", outcome: "REPAIR", supplierReference: "MT-RMA-5521" });
    // A repaired unit can come back again.
    expect((await returnableLines(db, order.id)).lines[0].units.map((u) => u.id)).toEqual([units[0].id]);
  });

  it("credits a return, lowers what is owed and records the refund of an overpayment", async () => {
    const { org, owner, order, line, units } = await sold(2);
    const owedBefore = (await accountBalance(db, org.organisationId)).owed;
    await recordPayment(db, admin, { key: KEY }, order.id, { amount: amount(order.totalMinor), reference: "EFT 1", receivedOn: today() });
    const r = await requestReturn(db, { key: KEY }, owner, order.number, { reason: "NOT_NEEDED", wants: "CREDIT", details: "One too many.", quantities: { [line.id]: "1" }, units: [units[1].id] });
    await advanceReturn(db, admin, { key: KEY }, r.id, "approve", { note: "" });
    await advanceReturn(db, admin, { key: KEY }, r.id, "receive", { note: "" });
    await expect(advanceReturn(db, await makeStaff("SALES"), { key: KEY }, r.id, "credit", { note: "" })).rejects.toThrow(/role/);
    const finance = await makeStaff("FINANCE");
    await advanceReturn(db, finance, { key: KEY }, r.id, "credit", { note: "" });
    const cn = await db.creditNote.findFirstOrThrow({ where: { returnId: r.id } });
    expect(cn).toMatchObject({ number: expect.stringMatching(/^CN-\d+$/), totalMinor: line.unitPriceMinor, organisationId: org.organisationId });
    expect(await db.unit.findUniqueOrThrow({ where: { id: units[1].id } })).toMatchObject({ status: "RETURNED" });
    expect(await db.returnRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "CLOSED", outcome: "CREDIT" });

    const m = await moneyFor(db, order.id);
    expect(m).toMatchObject({ credited: cn.totalMinor, outstanding: 0n, overpaid: cn.totalMinor });
    expect((await accountBalance(db, org.organisationId)).owed).toBe(0n);
    expect(owedBefore).toBe(order.totalMinor);
    const [inv] = await customerInvoices(db, owner);
    expect(inv).toMatchObject({ credited: cn.totalMinor, outstanding: 0n, state: "PAID" });
    const st = await customerStatement(db, owner, new Date(Date.now() - DAY), new Date(Date.now() + DAY));
    expect(st.accounts[0].entries.map((e) => e.kind).sort()).toEqual(["credit", "invoice", "payment"]);
    expect(st.accounts[0].closing).toBe(-cn.totalMinor);

    const { token } = await lastSecret(order.email, "creditnote.issued");
    const pdf = await PDFDocument.load(await creditNotePdf((await creditNoteByToken(db, cn.number, token))!, { appUrl: "http://localhost:3000", legalName: "ICT Distribution Africa" }));
    expect(pdf.getTitle()).toBe(`Credit note ${cn.number}`);
    expect(await creditNoteByToken(db, cn.number, "wrong")).toBeNull();

    await expect(recordRefund(db, finance, { key: KEY }, order.id, { amount: amount(cn.totalMinor + 1n), reference: "", paidOn: today() })).rejects.toMatchObject({ field: "amount" });
    await recordRefund(db, finance, { key: KEY }, order.id, { amount: amount(cn.totalMinor), reference: "EFT back", paidOn: today() });
    expect(await moneyFor(db, order.id)).toMatchObject({ overpaid: 0n, outstanding: 0n });
    await expect(recordRefund(db, finance, { key: KEY }, order.id, { amount: "1.00", reference: "", paidOn: today() })).rejects.toThrow(/Nothing is owed back/);
    expect(await db.outboundEmail.count({ where: { kind: "refund.paid", toAddress: order.email } })).toBe(1);
  });
});
