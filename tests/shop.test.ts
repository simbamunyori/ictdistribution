import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { shopProduct } from "../src/server/catalogue/shop";
import { setRate } from "../src/server/pricing/rates";
import { addToCart, cartFor, cartLines, priceLines } from "../src/server/shop/cart";
import { cancelOrder, cancelUnpaid, fulfilOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext, priceOf } from "../src/server/shop/prices";
import { addCollectionPoint, updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSpecial, launchConsignment, type SpecialInput } from "../src/server/shop/specials";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { DEFAULT_TIME_ZONE } from "../src/config/app";
import { toLocalInput } from "../src/lib/zoned";
import { db, hasDb, KEY, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const DAY = 24 * 60 * 60 * 1000;
type Staff = Awaited<ReturnType<typeof makeStaff>>;

let admin: Staff;
let categoryId: string;
let supplierId: string;

async function product(cost = "500", sellToIndividuals = true) {
  const mpn = `SHOP-${tag()}`;
  const p = await createProduct(db, admin, { name: `Laptop ${mpn}`, brand: "Lenovo", mpn, categoryId, summary: "", description: "", warrantyMonths: "", warrantyTerms: "", sellToIndividuals, status: "ACTIVE", sourcingRule: null });
  await saveOffer(db, admin, { supplierId, productId: p.id, cost, supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
  return reload(p.id);
}

/** A product as the shop prices it: with its category's parent. */
async function reload(id: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id }, include: { category: { select: { parentId: true } } } });
  return { ...p, parentCategoryId: p.category.parentId };
}

function special(o: Partial<SpecialInput> = {}): SpecialInput {
  const now = Date.now();
  return {
    name: `Special ${tag()}`,
    description: "",
    kind: "PRODUCT",
    items: [],
    categoryId: "",
    mode: "percent",
    percent: "10",
    price: "",
    marketCode: "",
    startsAt: toLocalInput(new Date(now - DAY), DEFAULT_TIME_ZONE),
    endsAt: toLocalInput(new Date(now + 7 * DAY), DEFAULT_TIME_ZONE),
    quantityLimit: "",
    perOrderLimit: "",
    customerTypes: ["INDIVIDUAL"],
    featured: false,
    active: true,
    ...o,
  };
}

const checkout = (o: Partial<CheckoutInput> = {}): CheckoutInput => ({
  email: "Buyer@Example.co.bw",
  name: "Thato  Molefe",
  phone: "+267 71 234 567",
  fulfilment: "DELIVERY",
  addressLine1: "Plot 5, Main Mall",
  addressLine2: "",
  city: "Gaborone",
  postalCode: "",
  collectionPointId: "",
  paymentMethod: "BANK_TRANSFER",
  notes: "",
  ...o,
});

const market = () => db.market.findUniqueOrThrow({ where: { code: "bw" } });
const ctxFor = async (type: "INDIVIDUAL" | "BUSINESS" = "INDIVIDUAL", now = new Date()) => priceContext(db, await market(), type, now);
const guest = { userId: null, organisationId: null };

async function cartWith(items: { productId?: string; bundleId?: string; quantity: number }[]) {
  const cart = await cartFor(db, undefined);
  for (const i of items) await addToCart(db, cart.id, i, i.quantity);
  return cart.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  await setRate(db, admin, "BWP", "13.65");
  categoryId = (await createCategory(db, admin, { name: `Shop ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
  supplierId = (await createSupplier(db, admin, { name: `Supplier ${tag()}`, kind: "LOCAL", country: "ZA", currency: "USD", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "0", preferred: false, active: true })).id;
  await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123" });
  await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
  await addCollectionPoint(db, admin, "bw", { name: "Test office", address: "Plot 1, Gaborone", hours: "" });
});

describe.skipIf(!hasDb)("shop prices", () => {
  it("keeps the landed cost current and never shows it to customers", async () => {
    const p = await product("500");
    expect(p.landedCostMinor).toBe(500_00n);
    await saveOffer(db, admin, { supplierId, productId: p.id, cost: "450", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor).toBe(450_00n);

    const shown = await shopProduct(db, p.slug, await ctxFor());
    expect(shown?.price?.amount.currency).toBe("BWP");
    const text = JSON.stringify(shown, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/landedCost|costMinor|supplier/i);
  });

  it("applies a special only to the customer types and dates it is for", async () => {
    const p = await product();
    await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }], customerTypes: ["BUSINESS"] }));
    const later = await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }], percent: "30", startsAt: toLocalInput(new Date(Date.now() + DAY), DEFAULT_TIME_ZONE) }));
    expect(priceOf(await ctxFor(), p)?.special).toBeNull();

    const running = await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }] }));
    const price = priceOf(await ctxFor(), p)!;
    expect(price.special?.id).toBe(running.id);
    expect(price.amount.amountMinor).toBeLessThan(price.was!.amountMinor);
    // Tomorrow the 30% one is running too, and is the lower price.
    expect(priceOf(await ctxFor("INDIVIDUAL", new Date(Date.now() + 2 * DAY)), p)?.special?.id).toBe(later.id);
  });

  it("refuses a special on a product individuals can't buy", async () => {
    const p = await product("500", false);
    await expect(createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }] }))).rejects.toThrow(/highlighted/);
  });

  it("charges the usual price beyond the per-order limit", async () => {
    const p = await product();
    await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }], perOrderLimit: "2" }));
    const ctx = await ctxFor();
    const [line] = await priceLines(db, await cartLines(db, await cartWith([{ productId: p.id, quantity: 3 }])), ctx);
    expect(line.specialUnits).toBe(2);
    expect(line.total!.amountMinor).toBe(line.specialUnit!.amountMinor * 2n + line.usualUnit!.amountMinor);
  });
});

describe.skipIf(!hasDb)("orders", () => {
  it("places an order with tax, delivery and a numbered reference, and empties the cart", async () => {
    const p = await product();
    const cartId = await cartWith([{ productId: p.id, quantity: 2 }]);
    const ctx = await ctxFor();
    const unit = priceOf(ctx, p)!.amount.amountMinor;
    const { order, token } = await placeOrder(db, { key: KEY }, cartId, ctx, guest, checkout());
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", email: "buyer@example.co.bw", name: "Thato Molefe", phone: "+26771234567", subtotalMinor: unit * 2n, deliveryMinor: 80_00n, totalMinor: unit * 2n + 80_00n, taxRateBps: 1400, bankDetails: "Test Bank\nAccount 123" });
    expect(order.number).toMatch(/^ICT-\d{6}$/);
    expect(order.taxMinor).toBe(order.totalMinor - (order.totalMinor * 10_000n + 5_700n) / 11_400n);
    expect(token.length).toBeGreaterThan(30);
    expect(await db.cartLine.count({ where: { cartId } })).toBe(0);
    expect(await db.outboundEmail.count({ where: { kind: "order.placed", toAddress: "buyer@example.co.bw" } })).toBeGreaterThan(0);

    const next = await placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }]), ctx, guest, checkout({ fulfilment: "COLLECTION", collectionPointId: (await db.collectionPoint.findFirstOrThrow({ where: { name: "Test office" } })).id }));
    expect(Number(next.order.number.slice(4))).toBe(Number(order.number.slice(4)) + 1);
    expect(next.order).toMatchObject({ deliveryMinor: 0n, totalMinor: unit, addressLine1: "" });
    expect(next.order.collectionText).toContain("Test office");
  });

  it("checks the details and refuses card until a gateway is live", async () => {
    const p = await product();
    const ctx = await ctxFor();
    await expect(placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }]), ctx, guest, checkout({ email: "nope", phone: "12", city: "" }))).rejects.toMatchObject({ fieldErrors: { email: expect.any(String), phone: expect.any(String), city: expect.any(String) } });
    await expect(placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }]), ctx, guest, checkout({ paymentMethod: "CARD" }))).rejects.toThrow(/Card payments/);
  });

  it("sells limited special units once, even to two buyers at the same moment", async () => {
    const p = await product();
    const s = await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }], quantityLimit: "1" }));
    const a = await cartWith([{ productId: p.id, quantity: 1 }]);
    const b = await cartWith([{ productId: p.id, quantity: 1 }]);
    const [ctxA, ctxB] = [await ctxFor(), await ctxFor()];
    const results = await Promise.allSettled([placeOrder(db, { key: KEY }, a, ctxA, guest, checkout()), placeOrder(db, { key: KEY }, b, ctxB, guest, checkout())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/sold out/);
    expect((await db.special.findUniqueOrThrow({ where: { id: s.id } })).quantityUsed).toBe(1);
  });

  it("is paid when payments cover it, then sent, and only staff with the role can do each", async () => {
    const p = await product();
    const { order } = await placeOrder(db, { key: KEY }, await cartWith([{ productId: p.id, quantity: 1 }]), await ctxFor(), guest, checkout());
    const today = new Date().toISOString().slice(0, 10);
    await expect(recordPayment(db, await makeStaff("SALES"), { key: KEY }, order.id, { amount: "1", reference: "", receivedOn: today })).rejects.toThrow(/role/);
    const finance = await makeStaff("FINANCE");
    await recordPayment(db, finance, { key: KEY }, order.id, { amount: "100", reference: "FNB 1", receivedOn: today });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
    await expect(fulfilOrder(db, admin, { key: KEY }, order.id, "")).rejects.toThrow(/isn't paid/);
    const rest = ((order.totalMinor - 100_00n) / 100n).toString() + "." + ((order.totalMinor - 100_00n) % 100n).toString().padStart(2, "0");
    await recordPayment(db, finance, { key: KEY }, order.id, { amount: rest, reference: "FNB 2", receivedOn: today });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    await fulfilOrder(db, await makeStaff("LOGISTICS"), { key: KEY }, order.id, "Courier ref 42");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FULFILLED");
    expect(await db.outboundEmail.count({ where: { kind: { in: ["order.paid", "order.sent"] }, toAddress: order.email } })).toBeGreaterThanOrEqual(2);
    await expect(cancelOrder(db, admin, { key: KEY }, order.id, "Changed mind")).rejects.toThrow(/can't be cancelled/);
  });

  it("gives special units back when an order is cancelled, by staff or for not paying", async () => {
    const p = await product();
    const s = await createSpecial(db, admin, special({ items: [{ productId: p.id, quantity: 1 }], quantityLimit: "5" }));
    const now = new Date();
    const one = await placeOrder(db, { key: KEY, now }, await cartWith([{ productId: p.id, quantity: 2 }]), await ctxFor(), guest, checkout());
    const two = await placeOrder(db, { key: KEY, now }, await cartWith([{ productId: p.id, quantity: 1 }]), await ctxFor(), guest, checkout());
    expect((await db.special.findUniqueOrThrow({ where: { id: s.id } })).quantityUsed).toBe(3);

    await expect(cancelOrder(db, admin, { key: KEY }, one.order.id, "")).rejects.toThrow(/Say why/);
    await cancelOrder(db, admin, { key: KEY }, one.order.id, "Out of stock at the supplier");
    expect((await db.special.findUniqueOrThrow({ where: { id: s.id } })).quantityUsed).toBe(1);

    const settings = await db.shopSettings.findUniqueOrThrow({ where: { id: "global" } });
    await cancelUnpaid(db, { key: KEY, now: new Date(now.getTime() + (settings.payDays + 1) * DAY) });
    expect((await db.order.findUniqueOrThrow({ where: { id: two.order.id } })).status).toBe("CANCELLED");
    expect((await db.special.findUniqueOrThrow({ where: { id: s.id } })).quantityUsed).toBe(0);
  });
});

describe.skipIf(!hasDb)("consignments", () => {
  it("records our own stock at its landed cost and launches a special limited to it", async () => {
    const p = await product("900");
    const s = await launchConsignment(db, admin, { productId: p.id, units: "40", unitCost: "400", currency: "USD", special: special() });
    expect(s).toMatchObject({ kind: "PRODUCT", quantityLimit: 40 });
    const offer = await db.supplierOffer.findFirstOrThrow({ where: { productId: p.id, source: "consignment" }, include: { supplier: true } });
    expect(offer).toMatchObject({ costMinor: 400_00n, stock: 40 });
    expect(offer.supplier.name).toBe("Our stock (USD)");
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor).toBe(400_00n);
    expect(priceOf(await ctxFor(), await reload(p.id))?.special?.id).toBe(s.id);
  });

  it("changes nothing when the special is wrong", async () => {
    const p = await product("900");
    await expect(launchConsignment(db, admin, { productId: p.id, units: "10", unitCost: "400", currency: "USD", special: special({ name: "" }) })).rejects.toThrow(/highlighted/);
    expect(await db.supplierOffer.count({ where: { productId: p.id, source: "consignment" } })).toBe(0);
    await expect(launchConsignment(db, await makeStaff("FINANCE"), { productId: p.id, units: "10", unitCost: "400", currency: "USD", special: special() })).rejects.toThrow(/role/);
  });
});
