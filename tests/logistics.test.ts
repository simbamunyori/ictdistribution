import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { applyOverride, boxCm3, chargeableGrams, dutyFor, estimateRoute, isForward, landedParts, type ShipmentSample } from "../src/lib/freight";
import { chooseOffer, type OfferForChoice } from "../src/lib/sourcing";
import { deliveryWithOrder, dispatchDelivery, linesToDeliver, markDelivered, prepareDelivery, serialsFor } from "../src/server/logistics/deliveries";
import { commercialInvoicePdf, deliveryNotePdf } from "../src/server/logistics/documents";
import { landedContext, routeEstimate } from "../src/server/logistics/landed";
import { saveDutyRule, updateLogisticsRules, type LogisticsRulesInput } from "../src/server/logistics/rules";
import { addPurchaseOrders, EMPTY_SHIPMENT, importShipments, recordShipment, saveOverride, setShipmentStatus, type ShipmentInput } from "../src/server/logistics/shipments";
import { countStock, saveWarehouse } from "../src/server/logistics/stock";
import { setLineTracking } from "../src/server/logistics/tracking";
import { setRate } from "../src/server/pricing/rates";
import { markPoReceived, startProcurement, updateProcurementRules } from "../src/server/procurement/purchase-orders";
import { poTerms } from "../src/server/procurement/supplier";
import { addToCart, cartFor } from "../src/server/shop/cart";
import { cancelOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext } from "../src/server/shop/prices";
import { updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const amount = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
const PNG = { name: "pod.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) };
type Staff = Awaited<ReturnType<typeof makeStaff>>;

describe("freight estimates", () => {
  const sample = (o: Partial<ShipmentSample> = {}): ShipmentSample => ({ chargeableGrams: 100_000, freight: 1000_00n, fees: 200_00n, insurance: 0n, goodsValue: null, transitDays: 4, ...o });

  it("charges the actual or the volumetric weight, whichever is more", () => {
    expect(boxCm3(400, 300, 100)).toBe(12_000);
    expect(boxCm3(400, null, 100)).toBeNull();
    // 12,000 cm3 by road at 333 kg per cubic metre is 3.996 kg.
    expect(chargeableGrams(2000, 12_000, 333)).toBe(3996);
    expect(chargeableGrams(5000, 12_000, 333)).toBe(5000);
    expect(chargeableGrams(2000, 0, 167)).toBe(2000);
  });

  it("takes the median per kilogram, so one odd shipment doesn't move it", () => {
    const est = estimateRoute([sample(), sample({ freight: 1200_00n, transitDays: 6 }), sample({ freight: 9000_00n, transitDays: 30 })])!;
    expect(est.perKg).toBe(12_00n);
    expect(est.feesPerKg).toBe(2_00n);
    expect(est.transitDays).toBe(6);
    expect(est.samples).toBe(3);
    expect(est.insuranceBps).toBeNull();
    expect(estimateRoute([sample({ insurance: 50_00n, goodsValue: 10_000_00n })])!.insuranceBps).toBe(50);
    expect(estimateRoute([sample({ freight: 0n })])).toBeNull();
  });

  it("lets staff's own figures win field by field, even with no history", () => {
    const est = estimateRoute([sample()])!;
    expect(applyOverride(est, { perKgMinor: 15_00n, feesPerKgMinor: null, transitDays: null })).toMatchObject({ perKg: 15_00n, feesPerKg: 2_00n, transitDays: 4, overridden: true });
    expect(applyOverride(null, { perKgMinor: 8_00n, feesPerKgMinor: null, transitDays: 10 })).toMatchObject({ perKg: 8_00n, feesPerKg: 0n, samples: 0 });
    expect(applyOverride(null, { perKgMinor: null, feesPerKgMinor: 1_00n, transitDays: null })).toBeNull();
  });

  it("finds duty by category, then its parent, then the rule for everything, with customs union origins free", () => {
    const rules = [
      { categoryId: null, destinationCountry: "BW", dutyBps: 500, leviesBps: 100, exemptOrigins: ["ZA"] },
      { categoryId: "parent", destinationCountry: "BW", dutyBps: 2000, leviesBps: 0, exemptOrigins: [] },
      { categoryId: "child", destinationCountry: "BW", dutyBps: 0, leviesBps: 0, exemptOrigins: [] },
    ];
    expect(dutyFor(rules, ["child", "parent"], "BW", "CN")).toEqual({ dutyBps: 0, leviesBps: 0, exempt: false });
    expect(dutyFor(rules, ["other", "parent"], "BW", "CN")).toEqual({ dutyBps: 2000, leviesBps: 0, exempt: false });
    expect(dutyFor(rules, ["other", null], "BW", "CN")).toEqual({ dutyBps: 500, leviesBps: 100, exempt: false });
    expect(dutyFor(rules, ["other", null], "BW", "ZA")).toEqual({ dutyBps: 0, leviesBps: 0, exempt: true });
    expect(dutyFor(rules, ["other"], "NA", "CN")).toEqual({ dutyBps: 0, leviesBps: 0, exempt: false });
  });

  it("lands a unit with freight and fees by weight, insurance on value and duty on all three", () => {
    const route = { perKg: 10_00n, feesPerKg: 2_00n, insuranceBps: null, transitDays: 4, samples: 1, overridden: false };
    const parts = landedParts(100_00n, 3996, route, 50, { dutyBps: 1000, leviesBps: 0 });
    expect(parts.freight).toBe(39_96n);
    expect(parts.fees).toBe(8_00n);
    expect(parts.insurance).toBe(50n);
    // 10% of 100.00 + 39.96 + 0.50
    expect(parts.duty).toBe(14_05n);
    expect(parts.total).toBe(39_96n + 8_00n + 50n + 14_05n);
  });

  it("picks the cheapest once landed, falling back to the allowance where freight can't be estimated", () => {
    const offer = (id: string, cost: bigint, landedCostBps: number): OfferForChoice => ({ id, costMinor: cost, currency: "USD", leadTimeDays: 5, stock: null, active: true, supplier: { id, name: id, active: true, preferred: false, leadTimeDays: 5, landedCostBps } });
    const offers = [offer("near", 105_00n, 3000), offer("far", 100_00n, 3000)];
    const noRate = () => null;
    expect(chooseOffer(offers, "CHEAPEST_LANDED", "USD", noRate).chosen!.offer.id).toBe("far");
    const choice = chooseOffer(offers, "CHEAPEST_LANDED", "USD", noRate, (o) => (o.id === "near" ? 2_00n : null));
    expect(choice.chosen!.offer.id).toBe("near");
    expect(choice.chosen!.landed!.amountMinor).toBe(107_00n);
    expect(choice.ranked[1].landed!.amountMinor).toBe(130_00n);
  });

  it("moves tracking forward only by itself", () => {
    expect(isForward(null, "ORDERED")).toBe(true);
    expect(isForward("SHIPPED", "IN_TRANSIT")).toBe(true);
    expect(isForward("IN_WAREHOUSE", "SHIPPED")).toBe(false);
    expect(isForward("DELIVERED", "DELIVERED")).toBe(false);
  });
});

describe.skipIf(!hasDb)("logistics", () => {
  let admin: Staff;
  let base: string;
  let categoryId: string;
  let supplier: { id: string; name: string };
  const ORIGIN = "MZ";
  const logisticsRules = (o: Partial<LogisticsRulesInput> = {}): LogisticsRulesInput => ({ homeCountry: "BW", airKgPerM3: "167", courierKgPerM3: "200", roadKgPerM3: "333", seaKgPerM3: "1000", insurancePercent: "0.5", sampleSize: "20", incoterm: "DAP", useStock: true, dropShipByDefault: false, ...o });
  const shipment = (o: Partial<ShipmentInput> = {}): ShipmentInput => ({ ...EMPTY_SHIPMENT, mode: "ROAD", originCountry: ORIGIN, destinationCountry: "BW", weightKg: "100", currency: base, freight: "1000", clearing: "200", ...o });

  async function product(name = "Router") {
    const mpn = `LG${tag()}`;
    const p = await createProduct(db, admin, { name: `${name} ${mpn}`, brand: "MikroTik", mpn, categoryId, summary: "", description: "", warrantyMonths: "12", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null, weightKg: "2", lengthCm: "40", widthCm: "30", heightCm: "10" });
    await saveOffer(db, admin, { supplierId: supplier.id, productId: p.id, cost: "100.00", supplierSku: "", leadTimeDays: "4", moq: "", stock: "", active: true });
    return p;
  }

  async function paidOrder(items: { productId: string; quantity: number }[]) {
    const cart = await cartFor(db, undefined);
    for (const i of items) await addToCart(db, cart.id, i, i.quantity);
    const ctx = await priceContext(db, await db.market.findUniqueOrThrow({ where: { code: "bw" } }), "INDIVIDUAL", new Date());
    const input: CheckoutInput = { email: `lg-${tag().toLowerCase()}@example.co.bw`, name: "Kagiso Moeng", phone: "+267 71 555 555", fulfilment: "DELIVERY", addressLine1: "Plot 77", addressLine2: "", city: "Maun", postalCode: "", collectionPointId: "", paymentMethod: "BANK_TRANSFER", notes: "" };
    const { order } = await placeOrder(db, { key: KEY }, cart.id, ctx, { userId: null, organisationId: null }, input);
    await recordPayment(db, await makeStaff("FINANCE"), { key: KEY }, order.id, { amount: amount(order.totalMinor), reference: "EFT", receivedOn: today() });
    await startProcurement(db, { key: KEY }, order.id);
    return db.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: { orderBy: { sortOrder: "asc" } }, purchaseOrders: { include: { lines: true } } } });
  }

  const level = (productId: string) => db.stockLevel.findFirst({ where: { productId } });

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await makeStaff("ADMIN");
    base = (await db.pricingSettings.findUniqueOrThrow({ where: { id: "global" } })).baseCurrency;
    await setRate(db, admin, "BWP", "13.65");
    await updateMarketTaxAndBank(db, admin, "bw", { taxName: "VAT", taxPercent: "14", bankDetails: "Test Bank\nAccount 123" });
    await updateMarketDelivery(db, admin, "bw", { deliveryEnabled: true, deliveryFee: "80", freeDeliveryFrom: "100000", deliveryNote: "" });
    await updateProcurementRules(db, admin, { autoSend: true, maxAutoValue: "100000", onlyPreferred: true, deliverTo: "Plot 50, Gaborone West", paymentTerms: "30 days" });
    await updateLogisticsRules(db, admin, logisticsRules());
    await saveWarehouse(db, admin, null, { code: `W${tag()}`, name: "Gaborone test warehouse", country: "BW", address: "Plot 50, Gaborone West", active: true, isDefault: true });
    categoryId = (await createCategory(db, admin, { name: `Routers ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null, hsCode: "8517.62" })).id;
    const s = await createSupplier(db, admin, { name: `Maputo Freight ${tag()}`, kind: "LOCAL", country: ORIGIN, currency: base, email: `mz-${tag().toLowerCase()}@example.co.mz`, whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "30", preferred: true, active: true, freightMode: "ROAD" });
    supplier = { id: s.id, name: s.name };
  });

  afterAll(async () => {
    if (!hasDb) return;
    await updateLogisticsRules(db, admin, logisticsRules());
  });

  it("uses the supplier's allowance until there is history, then the estimate from our shipments", async () => {
    const p = await product();
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor).toBe(130_00n);
    await recordShipment(db, admin, "HISTORY", shipment());
    const ctx = await landedContext(db);
    expect(routeEstimate(ctx, ORIGIN, "ROAD")).toMatchObject({ perKg: 10_00n, feesPerKg: 2_00n, samples: 1 });
    // 2 kg in a 40 x 30 x 10 cm box charges 3.996 kg by road: freight 39.96, fees 8.00 (rounded up), insurance 0.50.
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor).toBe(100_00n + 39_96n + 8_00n + 50n);
  });

  it("adds duty by category, and lets staff set their own freight figure", async () => {
    const p = await product("Switch");
    await saveDutyRule(db, admin, null, { categoryId, destinationCountry: "BW", dutyPercent: "10", leviesPercent: "0", exemptOrigins: "ZA", note: "" });
    const withDuty = (await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor!;
    expect(withDuty).toBe(100_00n + 39_96n + 8_00n + 50n + 14_05n);
    await saveOverride(db, admin, { originCountry: ORIGIN, mode: "ROAD", perKg: "20", feesPerKg: "", transitDays: "", note: "New rate card" });
    expect((await landedContext(db)).routes.get(`${ORIGIN}:ROAD`)).toMatchObject({ perKg: 20_00n, feesPerKg: 2_00n, overridden: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).landedCostMinor).toBeGreaterThan(withDuty);
    await expect(saveDutyRule(db, admin, null, { categoryId, destinationCountry: "BW", dutyPercent: "5", leviesPercent: "", exemptOrigins: "", note: "" })).rejects.toThrow(/already a rule/);
    await expect(saveDutyRule(db, admin, null, { categoryId: "", destinationCountry: "XX", dutyPercent: "500", leviesPercent: "", exemptOrigins: "ZZ", note: "" })).rejects.toMatchObject({ fieldErrors: { destinationCountry: expect.any(String), dutyPercent: expect.any(String), exemptOrigins: expect.any(String) } });
  });

  it("loads past shipments from a file, all or nothing", async () => {
    const before = await db.shipment.count();
    const head = "mode,origin_country,destination_country,weight_kg,volume_m3,currency,freight,clearing,shipped_on,arrived_on";
    await expect(importShipments(db, admin, `${head}\nAIR,TZ,BW,40,0.3,USD,500,80,2026-01-02,2026-01-09\nBOAT,TZ,BW,abc,,USD,500,,,\n`)).rejects.toThrow(/Row 3: mode .*weightKg/s);
    expect(await db.shipment.count()).toBe(before);
    await expect(importShipments(db, admin, "mode,origin_country\nAIR,TZ\n")).rejects.toThrow(/needs these columns/);
    expect(await importShipments(db, admin, `${head}\nAIR,TZ,BW,40,0.3,USD,500,80,2026-01-02,2026-01-09\n"AIR",TZ,BW,"1,000",,USD,"9,000.00",,,\n`)).toBe(2);
    const imported = await db.shipment.findMany({ where: { originCountry: "TZ" }, orderBy: { number: "asc" } });
    expect(imported.map((s) => [s.source, s.status, s.weightGrams, s.volumeCm3, s.transitDays])).toEqual([
      ["HISTORY", "ARRIVED", 40_000, 300_000, 7],
      ["HISTORY", "ARRIVED", 1_000_000, 0, null],
    ]);
    expect(imported[1].freightMinor).toBe(9000_00n);
  });

  it("fills a line from free stock instead of buying it, and lets it go when the order is cancelled", async () => {
    const p = await product("Access point");
    const warehouse = (await db.logisticsSettings.findUniqueOrThrow({ where: { id: "global" } })).defaultWarehouseId!;
    await countStock(db, admin, warehouse, p.id, "3", "Opening count");
    const order = await paidOrder([{ productId: p.id, quantity: 2 }]);
    expect(order.lines[0]).toMatchObject({ fromStock: true, tracking: "IN_WAREHOUSE" });
    expect(order.purchaseOrders).toHaveLength(0);
    expect(await level(p.id)).toMatchObject({ onHand: 3, allocated: 2 });
    await expect(countStock(db, admin, warehouse, p.id, "1", "")).rejects.toThrow(/2 are kept for orders/);
    // Only one is free now, so the next order for two is bought.
    const second = await paidOrder([{ productId: p.id, quantity: 2 }]);
    expect(second.lines[0].fromStock).toBe(false);
    expect(second.purchaseOrders).toHaveLength(1);
    expect(second.purchaseOrders[0].lines[0].productId).toBe(p.id);
    await cancelOrder(db, admin, { key: KEY }, order.id, "Customer changed their mind");
    expect(await level(p.id)).toMatchObject({ onHand: 3, allocated: 0 });
  });

  it("receives a purchase order into stock kept for its order, moved along by its shipment", async () => {
    const p = await product("Firewall");
    const order = await paidOrder([{ productId: p.id, quantity: 4 }]);
    const po = order.purchaseOrders[0];
    expect(po.status).toBe("SENT");
    expect(po.dropShip).toBe(false);
    expect((await db.orderLine.findUniqueOrThrow({ where: { id: order.lines[0].id } })).tracking).toBe("ORDERED");
    const live = await recordShipment(db, admin, "LIVE", shipment({ freight: "", clearing: "" }));
    expect(live.status).toBe("BOOKED");
    await expect(addPurchaseOrders(db, admin, live.id, "PO-NOPE")).rejects.toThrow(/No purchase order PO-NOPE/);
    await addPurchaseOrders(db, admin, live.id, po.number);
    await setShipmentStatus(db, admin, live.id, "AT_CUSTOMS");
    const line = () => db.orderLine.findUniqueOrThrow({ where: { id: order.lines[0].id }, include: { trackingEvents: { orderBy: { at: "asc" } } } });
    expect((await line()).tracking).toBe("AT_CUSTOMS");
    await setShipmentStatus(db, admin, live.id, "ARRIVED");
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    expect(await level(p.id)).toMatchObject({ onHand: 4, allocated: 4 });
    const l = await line();
    expect(l.tracking).toBe("IN_WAREHOUSE");
    expect(l.trackingEvents.map((e) => e.status)).toEqual(["ORDERED", "AT_CUSTOMS", "IN_WAREHOUSE"]);
    await expect(setShipmentStatus(db, admin, live.id, "IN_TRANSIT")).rejects.toThrow(/arrived/);
  });

  it("delivers an order in parts, with a note and proof, and tells the customer once it has all left", async () => {
    const p = await product("Patch panel");
    const order = await paidOrder([{ productId: p.id, quantity: 3 }]);
    await markPoReceived(db, admin, { key: KEY }, order.purchaseOrders[0].id);
    const lineId = order.lines[0].id;
    await expect(prepareDelivery(db, admin, order.id, { quantities: { [lineId]: "4" }, carrier: "", reference: "" })).rejects.toMatchObject({ fieldErrors: { [`qty-${lineId}`]: "Enter up to 3." } });
    const first = await prepareDelivery(db, admin, order.id, { quantities: { [lineId]: "1" }, carrier: "Courier Guy", reference: "CG1" });
    expect(first.number).toMatch(/^DN-\d+$/);
    expect((await linesToDeliver(db, order.id))[0].toDeliver).toBe(2);
    await dispatchDelivery(db, admin, { key: KEY }, first.id, { carrier: "", reference: "" });
    expect(await level(p.id)).toMatchObject({ onHand: 2, allocated: 2 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect((await db.orderLine.findUniqueOrThrow({ where: { id: lineId } })).tracking).toBe("OUT_FOR_DELIVERY");
    const rest = await prepareDelivery(db, admin, order.id, { quantities: { [lineId]: "2" }, carrier: "", reference: "" });
    await dispatchDelivery(db, admin, { key: KEY }, rest.id, { carrier: "Courier Guy", reference: "CG2" });
    expect(await level(p.id)).toMatchObject({ onHand: 0, allocated: 0 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FULFILLED");
    expect(await db.outboundEmail.count({ where: { toAddress: order.email, kind: "order.sent" } })).toBe(1);
    await markDelivered(db, admin, { key: KEY }, first.id, "K. Moeng", PNG);
    expect((await db.orderLine.findUniqueOrThrow({ where: { id: lineId } })).tracking).toBe("OUT_FOR_DELIVERY");
    await expect(markDelivered(db, admin, { key: KEY }, rest.id, "K. Moeng", { name: "x.exe", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) })).rejects.toThrow(/PDF or a photo/);
    await markDelivered(db, admin, { key: KEY }, rest.id, "K. Moeng", null);
    expect((await db.orderLine.findUniqueOrThrow({ where: { id: lineId } })).tracking).toBe("DELIVERED");
    expect((await db.delivery.findUniqueOrThrow({ where: { id: first.id } })).podContentType).toBe("image/png");

    const d = (await deliveryWithOrder(db, first.number))!;
    const note = await PDFDocument.load(await deliveryNotePdf(d, await serialsFor(db, [lineId]), { appUrl: "https://ictdistribution.africa", legalName: "ICT Distribution Africa (Pty) Ltd" }));
    expect(note.getTitle()).toBe(`Delivery note ${first.number}`);
    const full = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, market: true } });
    const invoice = await PDFDocument.load(await commercialInvoicePdf(db, full, { legalName: "ICT Distribution Africa (Pty) Ltd" }));
    expect(invoice.getTitle()).toBe(`Commercial invoice ${order.number}`);
  });

  it("drop-ships to the customer when the rules say so, without touching stock", async () => {
    await updateLogisticsRules(db, admin, logisticsRules({ dropShipByDefault: true }));
    const p = await product("Camera");
    const order = await paidOrder([{ productId: p.id, quantity: 1 }]);
    const po = order.purchaseOrders[0];
    expect(po).toMatchObject({ dropShip: true, warehouseId: null });
    expect((await poTerms(db, po.id)).deliverTo).toMatch(/^Kagiso Moeng, \+26771555555\nPlot 77\nMaun\nBotswana$/);
    await markPoReceived(db, admin, { key: KEY }, po.id);
    expect((await db.orderLine.findUniqueOrThrow({ where: { id: order.lines[0].id } })).tracking).toBe("DELIVERED");
    expect(await level(p.id)).toBeNull();
    await updateLogisticsRules(db, admin, logisticsRules());
  });

  it("lets staff set a line's step by hand, and checks who may", async () => {
    const p = await product("Cable");
    const order = await paidOrder([{ productId: p.id, quantity: 1 }]);
    await setLineTracking(db, admin, order.lines[0].id, "AT_CUSTOMS", "Held for inspection");
    const events = await db.trackingEvent.findMany({ where: { orderLineId: order.lines[0].id }, orderBy: { at: "asc" } });
    expect(events.at(-1)).toMatchObject({ status: "AT_CUSTOMS", note: "Held for inspection", byLabel: admin.name });
    await expect(setLineTracking(db, await makeStaff("FINANCE"), order.lines[0].id, "DELIVERED", "")).rejects.toThrow();
    await expect(recordShipment(db, await makeStaff("SALES"), "HISTORY", shipment())).rejects.toThrow();
    await expect(updateLogisticsRules(db, await makeStaff("LOGISTICS"), logisticsRules())).rejects.toThrow();
  });
});
