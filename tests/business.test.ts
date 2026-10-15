import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { accountBalance, applyForCredit, creditPosition, decideCredit, setCreditTerms } from "../src/server/accounts/credit";
import { addDocument, approveOrganisation, rejectOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { removeCustomerPrice, setCustomerPrice } from "../src/server/pricing/customer-prices";
import { addVolumeBreak, setCategoryMarkup } from "../src/server/pricing/levels";
import { setRate } from "../src/server/pricing/rates";
import { addToCart, cartFor, cartLines, priceLines } from "../src/server/shop/cart";
import { checkoutOptions, fulfilOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { canBuy, priceContext, priceOf, usualPrice } from "../src/server/shop/prices";
import { updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSpecial } from "../src/server/shop/specials";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { DEFAULT_TIME_ZONE } from "../src/config/app";
import { toLocalInput } from "../src/lib/zoned";
import { addMember, db, hasDb, KEY, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const DAY = 24 * 60 * 60 * 1000;
const PDF = { name: "certificate.pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")) };
type Staff = Awaited<ReturnType<typeof makeStaff>>;
type Org = Awaited<ReturnType<typeof makeOrganisation>>;

let admin: Staff;
let parentId: string;
let childId: string;
let supplierId: string;

async function product(cost = "500", o: { sellToIndividuals?: boolean; categoryId?: string } = {}) {
  const mpn = `BIZ-${tag()}`;
  const p = await createProduct(db, admin, { name: `Switch ${mpn}`, brand: "Cisco", mpn, categoryId: o.categoryId ?? childId, summary: "", description: "", warrantyMonths: "", warrantyTerms: "", sellToIndividuals: o.sellToIndividuals ?? true, status: "ACTIVE", sourcingRule: null });
  await saveOffer(db, admin, { supplierId, productId: p.id, cost, supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id }, include: { category: { select: { parentId: true } } } });
  return { ...row, parentCategoryId: row.category.parentId };
}

const details = { name: "Mogoditshane Networks", registrationNumber: "BW00001234567", taxNumber: "C01234567890", address: "Plot 42, Mogoditshane, Botswana", directors: "Neo Kgosi\nMpho Dube" };

/** A business we have checked and approved. */
async function approvedOrg(type: "BUSINESS" | "RESELLER" = "BUSINESS"): Promise<Org> {
  const org = await makeOrganisation(`Approved ${tag()}`, type);
  await saveBusinessDetails(db, org.owner, { ...details, name: `Approved ${tag()}` });
  await addDocument(db, org.owner, "REGISTRATION", PDF);
  await addDocument(db, org.owner, "TAX", PDF);
  await submitForCheck(db, org.owner, {});
  await approveOrganisation(db, admin, { key: KEY }, org.organisationId);
  return org;
}

const market = () => db.market.findUniqueOrThrow({ where: { code: "bw" } });
const ctxFor = async (type: "INDIVIDUAL" | "BUSINESS" | "RESELLER" = "INDIVIDUAL", organisationId: string | null = null, now = new Date()) => priceContext(db, await market(), type, now, organisationId);

async function cartWith(items: { productId: string; quantity: number }[], trade = false) {
  const cart = await cartFor(db, undefined);
  for (const i of items) await addToCart(db, cart.id, i, i.quantity, { trade });
  return cart.id;
}

const checkout = (o: Partial<CheckoutInput> = {}): CheckoutInput => ({
  email: "accounts@example.co.bw",
  name: "Neo Kgosi",
  phone: "+267 71 234 567",
  fulfilment: "DELIVERY",
  addressLine1: "Plot 42",
  addressLine2: "",
  city: "Mogoditshane",
  postalCode: "",
  collectionPointId: "",
  paymentMethod: "ACCOUNT",
  notes: "",
  customerReference: "PO-7781",
  ...o,
});

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  await setRate(db, admin, "BWP", "13.65");
  parentId = (await createCategory(db, admin, { name: `Networking ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
  childId = (await createCategory(db, admin, { name: `Switches ${tag()}`, description: "", parentId, sortOrder: 0, active: true, sourcingRule: null })).id;
  supplierId = (await createSupplier(db, admin, { name: `Supplier ${tag()}`, kind: "LOCAL", country: "ZA", currency: "USD", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "0", preferred: false, active: true })).id;
  await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123" });
  await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
});

describe.skipIf(!hasDb)("business checks", () => {
  it("needs the details and both certificates before it can be sent, then locks them", async () => {
    const org = await makeOrganisation(`Check ${tag()}`);
    await expect(saveBusinessDetails(db, org.owner, { ...details, taxNumber: "", directors: "" })).rejects.toMatchObject({ fieldErrors: { taxNumber: expect.any(String), directors: expect.any(String) } });
    await saveBusinessDetails(db, org.owner, details);
    await expect(submitForCheck(db, org.owner, {})).rejects.toThrow(/registration certificate and the tax certificate/);
    await expect(addDocument(db, org.owner, "REGISTRATION", { name: "x.exe", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) })).rejects.toThrow(/PDF/);
    await addDocument(db, org.owner, "REGISTRATION", PDF);
    await addDocument(db, org.owner, "TAX", PDF);
    await submitForCheck(db, org.owner, {});
    expect((await db.organisation.findUniqueOrThrow({ where: { id: org.organisationId } })).verification).toBe("PENDING");
    await expect(saveBusinessDetails(db, org.owner, details)).rejects.toThrow(/checking these details/);
    await expect(addDocument(db, org.owner, "OTHER", PDF)).rejects.toThrow(/checking/);
  });

  it("lets only the owner send details, and only staff with the role decide", async () => {
    const org = await makeOrganisation(`Roles ${tag()}`);
    const buyer = await addMember(org.organisationId, "BUYER");
    await expect(saveBusinessDetails(db, buyer, details)).rejects.toThrow(/role|permission|owner/i);
    await saveBusinessDetails(db, org.owner, details);
    await addDocument(db, org.owner, "REGISTRATION", PDF);
    await addDocument(db, org.owner, "TAX", PDF);
    await submitForCheck(db, org.owner, {});
    await expect(approveOrganisation(db, await makeStaff("LOGISTICS"), { key: KEY }, org.organisationId)).rejects.toThrow(/role/);

    await expect(rejectOrganisation(db, admin, { key: KEY }, org.organisationId, "")).rejects.toThrow(/Say what/);
    await rejectOrganisation(db, await makeStaff("SALES"), { key: KEY }, org.organisationId, "The tax certificate is unreadable. Send a clearer copy.");
    const sent = await db.organisation.findUniqueOrThrow({ where: { id: org.organisationId } });
    expect(sent).toMatchObject({ verification: "REJECTED", verificationNote: expect.stringMatching(/unreadable/) });
    expect(await db.outboundEmail.count({ where: { kind: "organisation.changes-needed", toAddress: org.email } })).toBe(1);

    // They correct it and send again; this time it is approved and the owner told.
    await addDocument(db, org.owner, "TAX", PDF);
    await submitForCheck(db, org.owner, {});
    await approveOrganisation(db, await makeStaff("FINANCE"), { key: KEY }, org.organisationId);
    expect((await db.organisation.findUniqueOrThrow({ where: { id: org.organisationId } })).verification).toBe("APPROVED");
    expect(await db.outboundEmail.count({ where: { kind: "organisation.approved", toAddress: org.email } })).toBe(1);
    const seen = await db.auditEvent.findMany({ where: { organisationId: org.organisationId, visibleToCustomer: true }, select: { action: true } });
    expect(seen.map((e) => e.action)).toEqual(expect.arrayContaining(["organisation.submitted", "organisation.sent-back", "organisation.approved"]));
  });
});

describe.skipIf(!hasDb)("price levels", () => {
  it("uses a category's markup for it and the categories under it", async () => {
    const p = await product("500");
    const before = usualPrice(await ctxFor("RESELLER"), p)!;
    const business = usualPrice(await ctxFor("BUSINESS"), p)!.amountMinor;
    await setCategoryMarkup(db, admin, "RESELLER", parentId, "1");
    const after = usualPrice(await ctxFor("RESELLER"), p)!;
    expect(after.amountMinor).toBeLessThan(before.amountMinor);
    // The child's own markup wins over its parent's.
    await setCategoryMarkup(db, admin, "RESELLER", childId, "50");
    expect(usualPrice(await ctxFor("RESELLER"), p)!.amountMinor).toBeGreaterThan(before.amountMinor);
    // Other levels are untouched.
    expect(usualPrice(await ctxFor("BUSINESS"), p)!.amountMinor).toBe(business);
    await expect(setCategoryMarkup(db, await makeStaff("SALES"), "RESELLER", childId, "5")).rejects.toThrow(/role/);
    await expect(setCategoryMarkup(db, admin, "RESELLER", childId, "lots")).rejects.toThrow(/percentage/);
  });

  it("takes a volume break off units bought at the usual price only", async () => {
    const cat = (await createCategory(db, admin, { name: `Cables ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
    const p = await product("100", { categoryId: cat });
    await addVolumeBreak(db, admin, "BUSINESS", { minQuantity: "10", discountPercent: "5", categoryId: cat });
    await addVolumeBreak(db, admin, "BUSINESS", { minQuantity: "50", discountPercent: "8", categoryId: cat });
    await expect(addVolumeBreak(db, admin, "BUSINESS", { minQuantity: "10", discountPercent: "6", categoryId: cat })).rejects.toThrow(/already a break/);
    await expect(addVolumeBreak(db, admin, "BUSINESS", { minQuantity: "1", discountPercent: "60", categoryId: "" })).rejects.toMatchObject({ fieldErrors: { minQuantity: expect.any(String), discountPercent: expect.any(String) } });

    const ctx = await ctxFor("BUSINESS");
    const usual = usualPrice(ctx, p)!.amountMinor;
    const [nine] = await priceLines(db, await cartLines(db, await cartWith([{ productId: p.id, quantity: 9 }], true)), ctx);
    expect(nine.volumeDiscountBps).toBe(0);
    const [sixty] = await priceLines(db, await cartLines(db, await cartWith([{ productId: p.id, quantity: 60 }], true)), ctx);
    expect(sixty.volumeDiscountBps).toBe(800);
    expect(sixty.total!.amountMinor).toBe(sixty.volumeUnit!.amountMinor * 60n);
    expect(sixty.volumeUnit!.amountMinor).toBeLessThan(usual);
    // Individuals have no breaks here.
    const [retail] = await priceLines(db, await cartLines(db, await cartWith([{ productId: p.id, quantity: 10 }])), await ctxFor());
    expect(retail.volumeDiscountBps).toBe(0);
  });

  it("does not stack a volume break on special units", async () => {
    const cat = (await createCategory(db, admin, { name: `Racks ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
    const p = await product("100", { categoryId: cat });
    await addVolumeBreak(db, admin, "BUSINESS", { minQuantity: "5", discountPercent: "5", categoryId: cat });
    const now = Date.now();
    await createSpecial(db, admin, { name: `Rack deal ${tag()}`, description: "", kind: "PRODUCT", items: [{ productId: p.id, quantity: 1 }], categoryId: "", mode: "percent", percent: "20", price: "", marketCode: "", startsAt: toLocalInput(new Date(now - DAY), DEFAULT_TIME_ZONE), endsAt: toLocalInput(new Date(now + DAY), DEFAULT_TIME_ZONE), quantityLimit: "", perOrderLimit: "2", customerTypes: ["BUSINESS"], featured: false, active: true });
    const [line] = await priceLines(db, await cartLines(db, await cartWith([{ productId: p.id, quantity: 6 }], true)), await ctxFor("BUSINESS"));
    expect(line.specialUnits).toBe(2);
    expect(line.total!.amountMinor).toBe(line.specialUnit!.amountMinor * 2n + line.volumeUnit!.amountMinor * 4n);
  });
});

describe.skipIf(!hasDb)("agreed prices", () => {
  it("replaces the level's price for that business only, until it ends", async () => {
    const org = await approvedOrg();
    const other = await approvedOrg();
    const p = await product("500");
    await expect(setCustomerPrice(db, await makeStaff("LOGISTICS"), org.organisationId, { productId: p.id, price: "1", validUntil: "", note: "" })).rejects.toThrow(/role/);
    await expect(setCustomerPrice(db, admin, org.organisationId, { productId: p.id, price: "abc", validUntil: "2000-01-01", note: "" })).rejects.toMatchObject({ fieldErrors: { price: expect.any(String), validUntil: expect.any(String) } });
    await setCustomerPrice(db, await makeStaff("SALES"), org.organisationId, { productId: p.id, price: "4321.00", validUntil: "", note: "Quote Q-12" });

    const mine = priceOf(await ctxFor("BUSINESS", org.organisationId), p)!;
    expect(mine).toMatchObject({ agreed: true, amount: { amountMinor: 4321_00n, currency: "BWP" } });
    expect(priceOf(await ctxFor("BUSINESS", other.organisationId), p)!.agreed).toBe(false);
    // With no end date it holds later too; once it ends, the level's price is back.
    expect(priceOf(await ctxFor("BUSINESS", org.organisationId, new Date(Date.now() + 400 * DAY)), p)!.agreed).toBe(true);
    const row = await db.customerPrice.findFirstOrThrow({ where: { organisationId: org.organisationId, productId: p.id } });
    await db.customerPrice.update({ where: { id: row.id }, data: { validUntil: new Date(Date.now() - DAY) } });
    expect(priceOf(await ctxFor("BUSINESS", org.organisationId), p)!.agreed).toBe(false);
    await removeCustomerPrice(db, admin, row.id);
    expect(await db.customerPrice.count({ where: { id: row.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { organisationId: org.organisationId, action: "customer-price.set", visibleToCustomer: true } })).toBe(1);
  });
});

describe.skipIf(!hasDb)("products for businesses", () => {
  it("prices them only for approved businesses and keeps them out of retail carts", async () => {
    const p = await product("500", { sellToIndividuals: false });
    expect(canBuy({ trade: false }, p)).toBe(false);
    expect(priceOf(await ctxFor(), p)).toBeNull();
    expect(priceOf(await ctxFor("BUSINESS"), p)).not.toBeNull();
    const cart = await cartFor(db, undefined);
    await expect(addToCart(db, cart.id, { productId: p.id }, 1, { trade: false })).rejects.toThrow(/trade account/);
    expect(await addToCart(db, cart.id, { productId: p.id }, 500, { trade: true })).toBe(500);
    // The same cart, looked at as a retail shopper, can't be checked out.
    const [line] = await priceLines(db, await cartLines(db, cart.id), await ctxFor());
    expect(line.problem).toMatch(/trade account/);
  });
});

describe.skipIf(!hasDb)("credit", () => {
  async function withCredit(limit = "10000", days = "30") {
    const org = await approvedOrg();
    await applyForCredit(db, org.owner, { limit, termsDays: days, details: "We spend about P20,000 a month. References: Acme (71 000 000), Beta (72 000 000)." });
    const app = await db.creditApplication.findFirstOrThrow({ where: { organisationId: org.organisationId, status: "PENDING" } });
    await decideCredit(db, await makeStaff("FINANCE"), { key: KEY }, app.id, { approve: true, limit, termsDays: days, note: "" });
    return org;
  }

  it("needs an approved business and the finance role to apply, and Finance to decide", async () => {
    const unchecked = await makeOrganisation(`Unchecked ${tag()}`);
    const apply = { limit: "5000", termsDays: "30", details: "Monthly spend P10,000. References on request from our bank." };
    await expect(applyForCredit(db, unchecked.owner, apply)).rejects.toThrow(/check your business/);
    const org = await approvedOrg();
    await expect(applyForCredit(db, await addMember(org.organisationId, "BUYER"), apply)).rejects.toThrow(/role|permission/i);
    await applyForCredit(db, await addMember(org.organisationId, "FINANCE"), apply);
    await expect(applyForCredit(db, org.owner, apply)).rejects.toThrow(/with Finance already/);
    const app = await db.creditApplication.findFirstOrThrow({ where: { organisationId: org.organisationId } });
    await expect(decideCredit(db, await makeStaff("SALES"), { key: KEY }, app.id, { approve: true, limit: "5000", termsDays: "30", note: "" })).rejects.toThrow(/role/);
    await expect(decideCredit(db, admin, { key: KEY }, app.id, { approve: false, limit: "", termsDays: "", note: "" })).rejects.toThrow(/Say why/);
    await decideCredit(db, admin, { key: KEY }, app.id, { approve: false, limit: "", termsDays: "", note: "Too new to trade on terms. Try again in six months." });
    expect((await creditPosition(db, org.organisationId)).limit).toBeNull();
    expect(await db.outboundEmail.count({ where: { kind: "credit.declined", toAddress: org.email } })).toBe(1);
  });

  it("places orders on account within the limit, sends them before payment, and frees credit once paid", async () => {
    const org = await withCredit("10000", "30");
    expect(await db.outboundEmail.count({ where: { kind: "credit.approved", toAddress: org.email } })).toBe(1);
    const p = await product("100");
    const ctx = await ctxFor("BUSINESS", org.organisationId);
    const buyer = { userId: org.owner.userId, organisationId: org.organisationId, role: "OWNER" as const };
    expect((await checkoutOptions(db, "bw", org.organisationId)).account?.available).toBe(10_000_00n);

    const { order } = await placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 2 }], true), ctx, buyer, checkout());
    expect(order).toMatchObject({ status: "ON_ACCOUNT", paymentMethod: "ACCOUNT", customerReference: "PO-7781", organisationId: org.organisationId });
    expect(order.payBy!.getTime() - order.createdAt.getTime()).toBeGreaterThan(29 * DAY);
    expect((await accountBalance(db, org.organisationId)).owed).toBe(order.totalMinor);

    // Sent before it is paid.
    await fulfilOrder(db, admin, { key: KEY }, order.id, "Courier ref 9");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FULFILLED");
    expect((await accountBalance(db, org.organisationId)).owed).toBe(order.totalMinor);

    const amount = `${order.totalMinor / 100n}.${(order.totalMinor % 100n).toString().padStart(2, "0")}`;
    await recordPayment(db, await makeStaff("FINANCE"), { key: KEY }, order.id, { amount, reference: "EFT", receivedOn: new Date().toISOString().slice(0, 10) });
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paidAt).not.toBeNull();
    expect(paid.status).toBe("FULFILLED");
    expect((await accountBalance(db, org.organisationId)).owed).toBe(0n);
    expect(await db.outboundEmail.count({ where: { kind: "order.settled", toAddress: order.email } })).toBe(1);
  });

  it("refuses an order over the limit, on hold, or from someone who can't buy", async () => {
    const org = await withCredit("1000", "14");
    const p = await product("500");
    const ctx = await ctxFor("BUSINESS", org.organisationId);
    const buyer = { userId: org.owner.userId, organisationId: org.organisationId, role: "OWNER" as const };
    await expect(placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }], true), ctx, buyer, checkout())).rejects.toThrow(/more than your available credit/);
    const finance = await addMember(org.organisationId, "FINANCE");
    const small = await product("10");
    await expect(placeOrder(db, { key: KEY }, await cartWith([{ productId: small.id, quantity: 1 }], true), ctx, { userId: finance.userId, organisationId: org.organisationId, role: "FINANCE" }, checkout())).rejects.toThrow(/role|buy/i);
    await setCreditTerms(db, admin, org.organisationId, { limit: "1000", termsDays: "14", onHold: true });
    await expect(placeOrder(db, { key: KEY }, await cartWith([{ productId: small.id, quantity: 1 }], true), ctx, buyer, checkout())).rejects.toThrow(/on hold/);
    expect((await checkoutOptions(db, "bw", org.organisationId)).account).toBeNull();
    // Bank transfer still works.
    const { order } = await placeOrder(db, { key: KEY }, await cartWith([{ productId: small.id, quantity: 1 }], true), ctx, buyer, checkout({ paymentMethod: "BANK_TRANSFER" }));
    expect(order.status).toBe("AWAITING_PAYMENT");
  });

  it("lets only one of two orders at the same moment use the last of the limit", async () => {
    const p = await product("100");
    const ctx0 = await ctxFor("BUSINESS");
    const unit = usualPrice(ctx0, p)!.amountMinor;
    // Room for one order of 3 plus delivery, not two.
    const limit = (unit * 3n + 80_00n) * 3n / 2n;
    const org = await withCredit(`${limit / 100n}.${(limit % 100n).toString().padStart(2, "0")}`);
    const ctx = await ctxFor("BUSINESS", org.organisationId);
    const buyer = { userId: org.owner.userId, organisationId: org.organisationId, role: "OWNER" as const };
    const [a, b] = [await cartWith([{ productId: p.id, quantity: 3 }], true), await cartWith([{ productId: p.id, quantity: 3 }], true)];
    const results = await Promise.allSettled([placeOrder(db, { key: KEY }, a, ctx, buyer, checkout()), placeOrder(db, { key: KEY }, b, ctx, buyer, checkout())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/available credit/);
    const pos = await creditPosition(db, org.organisationId);
    expect(pos.owed).toBeLessThanOrEqual(limit);
  });

  it("closes an account and keeps what is owed", async () => {
    const org = await withCredit("5000");
    const p = await product("100");
    const ctx = await ctxFor("BUSINESS", org.organisationId);
    await placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }], true), ctx, { userId: org.owner.userId, organisationId: org.organisationId, role: "OWNER" }, checkout());
    await setCreditTerms(db, admin, org.organisationId, { limit: "", termsDays: "", onHold: false });
    const pos = await creditPosition(db, org.organisationId);
    expect(pos).toMatchObject({ limit: null, open: false });
    expect(pos.owed).toBeGreaterThan(0n);
    await expect(setCreditTerms(db, admin, (await makeOrganisation(`New ${tag()}`)).organisationId, { limit: "100", termsDays: "30", onHold: false })).rejects.toThrow(/Approve the business/);
  });
});
