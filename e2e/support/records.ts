import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Addresses of seeded records for the pages that need an id: a demo
 * product, supplier and category, two demo price lists (one waiting
 * for its columns, one ready for review), a demo special, a demo
 * order with a known link, and the demo business with a document, a credit
 * application and a volume break at its level, two demo quotes (one
 * waiting for a check with a supplier request, one sent to the business),
 * and a paid order with two purchase orders (one sent with a known link,
 * one waiting for approval), travelling in a live shipment with one
 * delivery out and one being packed, and for the customer portal an
 * order of the demo business sent on account and part paid, with its
 * invoice, delivery, a return waiting and a saved list, made here when
 * missing.
 * Development and CI databases only.
 */
let cached: Promise<Record<string, string>> | null = null;

export function records(): Promise<Record<string, string>> {
  cached ??= load();
  return cached;
}

async function load(): Promise<Record<string, string>> {
  if (process.env.NODE_ENV === "production") throw new Error("Browser test records are for development and CI only.");
  const db = new PrismaClient();
  try {
    const product = await db.product.findFirstOrThrow({ where: { mpn: { startsWith: "DEMO-" }, offers: { some: {} } }, orderBy: { createdAt: "asc" }, include: { offers: true } });
    const supplier = await db.supplier.findUniqueOrThrow({ where: { id: product.offers[0].supplierId } });
    const category = await db.category.findFirstOrThrow({ where: { slug: "laptops" } });
    const file = new TextEncoder().encode(`Part No,Description,Dealer Price\n${product.mpn},${product.name.replace(/,/g, "")},1.00\n`);
    let columns = await db.priceListImport.findFirst({ where: { supplierId: supplier.id, status: "NEEDS_COLUMNS" } });
    columns ??= await db.priceListImport.create({ data: { supplierId: supplier.id, filename: "demo-list.csv", origin: "upload", file, status: "NEEDS_COLUMNS", createdByLabel: "Browser checks" } });
    let ready = await db.priceListImport.findFirst({ where: { supplierId: supplier.id, status: "READY" } });
    if (!ready) {
      ready = await db.priceListImport.create({ data: { supplierId: supplier.id, filename: "demo-list.csv", origin: "upload", file, status: "READY", summary: { PRICE_UP: 1, UNMATCHED: 1 }, largestMoveBps: 500, createdByLabel: "Browser checks" } });
      const cost = product.offers[0].costMinor;
      await db.priceListRow.createMany({
        data: [
          { importId: ready.id, line: 2, change: "PRICE_UP", mpn: product.mpn, name: product.name, costMinor: cost + cost / 20n, currency: supplier.currency, productId: product.id, previousCostMinor: cost, movedBps: 500 },
          { importId: ready.id, line: 3, change: "UNMATCHED", mpn: "DEMO-NEW-1", brand: "Lenovo", name: "A product we don't list yet", costMinor: 100_00n, currency: supplier.currency },
        ],
      });
    }
    const special = await db.special.findFirstOrThrow({ where: { slug: { startsWith: "demo-" } }, orderBy: { createdAt: "asc" } });
    const orderToken = "browser-checks-order";
    // Workers load these at the same time: whoever loses the race to create one reads the winner's.
    const once = async <T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> => (await find()) ?? (await create().catch(async (e) => (await find()) ?? Promise.reject(e)));
    const order = await once(() => db.order.findUnique({ where: { number: "ICT-TEST-1" } }), () => db.order.create({
      data: {
        number: "ICT-TEST-1",
        marketCode: "bw",
        currency: "BWP",
        customerType: "INDIVIDUAL",
        email: "guest@example.co.bw",
        name: "Thato Guest",
        phone: "+26771234567",
        fulfilment: "DELIVERY",
        addressLine1: "Plot 123, Kgale View",
        city: "Gaborone",
        paymentMethod: "BANK_TRANSFER",
        bankDetails: "Demo Bank (demo)\nAccount 000000000",
        subtotalMinor: 1_000_00n,
        deliveryMinor: 80_00n,
        totalMinor: 1_080_00n,
        taxMinor: 132_63n,
        taxName: "VAT",
        taxRateBps: 1400,
        accessTokenHash: createHash("sha256").update(orderToken).digest("hex"),
        payBy: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        lines: { create: [{ productId: product.id, description: product.name, mpn: product.mpn, quantity: 1, unitPriceMinor: 1_000_00n, lineTotalMinor: 1_000_00n }] },
      },
    }));
    // The demo business, with a document to check and a credit application waiting.
    const business = await db.organisation.findFirstOrThrow({ where: { name: "Kgale Hill Systems (demo)" } });
    if (!(await db.organisationDocument.findFirst({ where: { organisationId: business.id } }))) {
      await db.organisationDocument.create({ data: { organisationId: business.id, kind: "REGISTRATION", filename: "registration.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4\n% browser checks\n"), size: 27, uploadedByLabel: "Browser checks" } });
    }
    if (!(await db.creditApplication.findFirst({ where: { organisationId: business.id, status: "PENDING" } }))) {
      await db.creditApplication.create({ data: { organisationId: business.id, requestedLimitMinor: 80_000_00n, requestedTermsDays: 45, details: "Monthly spend about P60,000. References: Demo Traders (71 000 000), Demo Supplies (72 000 000).", appliedByLabel: "Browser checks" } });
    }
    // A volume break at the demo business's level, so trade product pages show one.
    if (!(await db.volumeBreak.findFirst({ where: { customerType: business.customerType, categoryId: product.categoryId, minQuantity: 3 } }))) {
      await db.volumeBreak.create({ data: { customerType: business.customerType, categoryId: product.categoryId, minQuantity: 3, discountBps: 300 } });
    }
    // Quotes: one waiting for a check, with a request to a supplier; one sent to the demo business.
    const hash = (t: string) => createHash("sha256").update(t).digest("hex");
    const quoteToken = "browser-checks-quote";
    const rfqToken = "browser-checks-rfq";
    const owner = await db.membership.findFirstOrThrow({ where: { organisationId: business.id, role: "OWNER" }, include: { user: true } });
    const price = 1_000_00n;
    const review = await once(() => db.quote.findUnique({ where: { number: "QTEST1" } }), () => db.quote.create({
      data: {
        number: "QTEST1",
        source: "EMAIL",
        status: "REVIEW",
        marketCode: "bw",
        currency: "BWP",
        customerType: "INDIVIDUAL",
        email: "buyer@example.co.bw",
        name: "Neo Buyer",
        companyName: "Demo Clinic",
        requestText: `2 x ${product.mpn}\n1 x 24 port managed switch`,
        reviewReasons: "Line 2, 24 port managed switch: no price yet.\nIt came from someone without an account.",
        taxRateBps: 1400,
        subtotalMinor: 2n * price,
        taxMinor: (2n * price * 14n) / 100n,
        totalMinor: 2n * price + (2n * price * 14n) / 100n,
        costBaseMinor: 120_00n,
        marginBps: 1500,
        lines: {
          create: [
            { position: 1, original: `2 x ${product.mpn}`, description: product.name, mpn: product.mpn, quantity: 2, productId: product.id, categoryId: product.categoryId, matchConfidence: 100, costSource: "CATALOGUE", supplierId: supplier.id, unitCostBaseMinor: 60_00n, unitPriceMinor: price, lineTotalMinor: 2n * price },
            { position: 2, original: "1 x 24 port managed switch", description: "24 port managed switch", quantity: 1, matchConfidence: 0 },
          ],
        },
      },
    }));
    const switchLine = await db.quoteLine.findFirstOrThrow({ where: { quoteId: review.id, position: 2 } });
    await once(() => db.supplierPriceRequest.findUnique({ where: { reference: "RFQ-TEST01" } }), () => db.supplierPriceRequest.create({ data: { quoteId: review.id, supplierId: supplier.id, reference: "RFQ-TEST01", channel: "EMAIL", status: "SENT", lineIds: [switchLine.id], tokenHash: hash(rfqToken), tokenSealed: "browser-checks", deadline: new Date(Date.now() + 24 * 3_600_000), sentAt: new Date() } }));
    const sent = await once(() => db.quote.findUnique({ where: { number: "QTEST2" } }), () => db.quote.create({
      data: {
        number: "QTEST2",
        type: "TENDER",
        source: "PORTAL",
        status: "SENT",
        marketCode: "bw",
        currency: "BWP",
        customerType: business.customerType,
        userId: owner.userId,
        organisationId: business.id,
        email: owner.user.email,
        name: owner.user.name,
        companyName: business.name,
        tenderReference: "DEMO/TND/001",
        tenderDeadline: new Date(Date.now() + 10 * 24 * 3_600_000),
        requiredDocuments: "Datasheets\nManufacturer warranty",
        includeDocuments: true,
        taxRateBps: 1400,
        subtotalMinor: 3n * price,
        taxMinor: (3n * price * 14n) / 100n,
        totalMinor: 3n * price + (3n * price * 14n) / 100n,
        costBaseMinor: 180_00n,
        marginBps: 1500,
        leadTimeDays: 5,
        paymentTerms: "Payment by bank transfer before delivery.",
        bankDetails: "Demo Bank (demo)\nAccount 000000000",
        validUntil: new Date(Date.now() + 14 * 24 * 3_600_000),
        accessTokenHash: hash(quoteToken),
        sentAt: new Date(),
        sentByLabel: "Automatically",
        lines: { create: [{ position: 1, original: `3 x ${product.mpn}`, description: product.name, mpn: product.mpn, quantity: 3, productId: product.id, categoryId: product.categoryId, matchConfidence: 100, costSource: "CATALOGUE", supplierId: supplier.id, unitCostBaseMinor: 60_00n, leadTimeDays: 5, unitPriceMinor: price, lineTotalMinor: 3n * price }] },
      },
    }));
    // An order paid and bought from its supplier: one purchase order sent, with a known link, and one waiting for approval.
    const poToken = "browser-checks-po";
    const procured = await once(() => db.order.findUnique({ where: { number: "ICT-TEST-2" } }), () => db.order.create({
      data: {
        number: "ICT-TEST-2",
        status: "PAID",
        marketCode: "bw",
        currency: "BWP",
        customerType: "INDIVIDUAL",
        email: "paid@example.co.bw",
        name: "Mpho Paid",
        phone: "+26771234567",
        fulfilment: "DELIVERY",
        addressLine1: "Plot 7, Tlokweng",
        city: "Gaborone",
        paymentMethod: "BANK_TRANSFER",
        subtotalMinor: 2_000_00n,
        deliveryMinor: 0n,
        totalMinor: 2_000_00n,
        taxMinor: 245_61n,
        taxName: "VAT",
        taxRateBps: 1400,
        accessTokenHash: hash("browser-checks-paid-order"),
        paidAt: new Date(),
        procuredAt: new Date(),
        lines: { create: [{ productId: product.id, description: product.name, mpn: product.mpn, quantity: 2, unitPriceMinor: 1_000_00n, lineTotalMinor: 2_000_00n, supplierId: supplier.id, supplierCostMinor: 60_00n, supplierCurrency: supplier.currency }] },
      },
      include: { lines: true },
    }));
    const procuredLine = await db.orderLine.findFirstOrThrow({ where: { orderId: procured.id } });
    const poLine = { orderLineId: procuredLine.id, position: 1, description: product.name, mpn: product.mpn, quantity: 2, unitCostMinor: 60_00n, lineTotalMinor: 120_00n };
    const sentPo = await once(() => db.purchaseOrder.findUnique({ where: { number: "PO-TEST1" } }), () => db.purchaseOrder.create({ data: { number: "PO-TEST1", orderId: procured.id, supplierId: supplier.id, status: "SENT", channel: "EMAIL", currency: supplier.currency, totalMinor: 120_00n, totalBaseMinor: 120_00n, tokenHash: hash(poToken), tokenSealed: "browser-checks", sentAt: new Date(), lines: { create: [poLine] } } }));
    const waitingPo = await once(() => db.purchaseOrder.findUnique({ where: { number: "PO-TEST2" } }), () => db.purchaseOrder.create({ data: { number: "PO-TEST2", orderId: procured.id, supplierId: supplier.id, status: "AWAITING_APPROVAL", channel: "EMAIL", currency: supplier.currency, totalMinor: 120_00n, totalBaseMinor: 120_00n, reviewReasons: "Sending by itself is switched off.", tokenHash: hash("browser-checks-po-2"), tokenSealed: "browser-checks", lines: { create: [poLine] } } }));
    // Logistics: the paid order's line ordered and shipped, travelling in a live shipment, with one delivery out and one being packed.
    if (!(await db.trackingEvent.findFirst({ where: { orderLineId: procuredLine.id } }))) {
      await db.trackingEvent.createMany({ data: [{ orderLineId: procuredLine.id, status: "ORDERED", byLabel: "Browser checks", at: new Date(Date.now() - 3 * 86_400_000) }, { orderLineId: procuredLine.id, status: "SHIPPED", byLabel: "Browser checks", note: "Waybill DEMO1" }] });
      await db.orderLine.update({ where: { id: procuredLine.id }, data: { tracking: "SHIPPED" } });
    }
    const liveShipment = await once(() => db.shipment.findUnique({ where: { number: "SH-TEST1" } }), () => db.shipment.create({ data: { number: "SH-TEST1", source: "LIVE", status: "IN_TRANSIT", mode: "AIR", originCountry: "CN", destinationCountry: "BW", carrier: "Demo Air (demo)", reference: "AWB 000-00000000", weightGrams: 45_000, volumeCm3: 200_000, currency: "USD", freightMinor: 460_00n, shippedOn: new Date(), notes: "Browser checks (demo)", createdByLabel: "Browser checks", purchaseOrders: { connect: [{ id: sentPo.id }] } } }));
    const pastShipment = await db.shipment.findFirstOrThrow({ where: { source: "HISTORY" }, orderBy: { createdAt: "asc" } });
    await once(() => db.delivery.findUnique({ where: { number: "DN-TEST1" } }), () => db.delivery.create({ data: { number: "DN-TEST1", orderId: procured.id, status: "DISPATCHED", carrier: "Demo Couriers", reference: "DC123", dispatchedAt: new Date(), createdByLabel: "Browser checks", lines: { create: [{ orderLineId: procuredLine.id, quantity: 1 }] } } }));
    await once(() => db.delivery.findUnique({ where: { number: "DN-TEST2" } }), () => db.delivery.create({ data: { number: "DN-TEST2", orderId: procured.id, status: "PREPARED", createdByLabel: "Browser checks", lines: { create: [{ orderLineId: procuredLine.id, quantity: 1 }] } } }));
    // The customer portal: an order for the demo business, sent on account and part paid, with its invoice, delivery, a return waiting and a saved list.
    const portal = await once(() => db.order.findUnique({ where: { number: "ICT-TEST-3" } }), () => db.order.create({
      data: {
        number: "ICT-TEST-3",
        status: "FULFILLED",
        marketCode: "bw",
        currency: "BWP",
        customerType: business.customerType,
        userId: owner.userId,
        organisationId: business.id,
        email: owner.user.email,
        name: owner.user.name,
        phone: "+26771234567",
        fulfilment: "DELIVERY",
        addressLine1: "Plot 50, Gaborone West",
        city: "Gaborone",
        paymentMethod: "ACCOUNT",
        customerReference: "PO-DEMO-77",
        subtotalMinor: 2_000_00n,
        deliveryMinor: 0n,
        totalMinor: 2_000_00n,
        taxMinor: 245_61n,
        taxName: "VAT",
        taxRateBps: 1400,
        accessTokenHash: hash("browser-checks-portal-order"),
        payBy: new Date(Date.now() - 5 * 86_400_000),
        procuredAt: new Date(Date.now() - 12 * 86_400_000),
        fulfilledAt: new Date(Date.now() - 10 * 86_400_000),
        createdAt: new Date(Date.now() - 35 * 86_400_000),
        lines: { create: [{ productId: product.id, description: product.name, mpn: product.mpn, quantity: 2, unitPriceMinor: 1_000_00n, lineTotalMinor: 2_000_00n, tracking: "DELIVERED", fromStock: true }] },
        payments: { create: [{ method: "ACCOUNT", amountMinor: 500_00n, reference: "EFT DEMO", receivedOn: new Date(Date.now() - 2 * 86_400_000), recordedByLabel: "Browser checks" }] },
      },
    }));
    const portalLine = await db.orderLine.findFirstOrThrow({ where: { orderId: portal.id } });
    await once(() => db.invoice.findUnique({ where: { number: "INV-TEST1" } }), () => db.invoice.create({ data: { number: "INV-TEST1", orderId: portal.id, userId: owner.userId, organisationId: business.id, currency: "BWP", totalMinor: 2_000_00n, taxMinor: 245_61n, billTo: `${business.name}\nAttention: ${owner.user.name}\nPlot 50, Gaborone West`, issuedAt: new Date(Date.now() - 10 * 86_400_000), dueAt: new Date(Date.now() - 5 * 86_400_000), accessTokenHash: hash("browser-checks-invoice") } }));
    await once(() => db.delivery.findUnique({ where: { number: "DN-TEST3" } }), () => db.delivery.create({ data: { number: "DN-TEST3", orderId: portal.id, status: "DELIVERED", carrier: "Demo Couriers", reference: "DC777", dispatchedAt: new Date(Date.now() - 10 * 86_400_000), deliveredAt: new Date(Date.now() - 9 * 86_400_000), receivedBy: "Reception", createdByLabel: "Browser checks", lines: { create: [{ orderLineId: portalLine.id, quantity: 2 }] } } }));
    const portalReturn = await once(() => db.returnRequest.findUnique({ where: { number: "RMA-TEST1" } }), () => db.returnRequest.create({ data: { number: "RMA-TEST1", orderId: portal.id, userId: owner.userId, organisationId: business.id, reason: "FAULTY", details: "It won't power on.", requestedByLabel: owner.user.name, lines: { create: [{ orderLineId: portalLine.id, quantity: 1 }] } } }));
    const portalList = await once(() => db.savedList.findFirst({ where: { organisationId: business.id, name: "Office kit (demo)" } }), () => db.savedList.create({ data: { name: "Office kit (demo)", userId: owner.userId, organisationId: business.id, lines: { create: [{ productId: product.id, quantity: 3 }] } } }));
    return { liveShipment: liveShipment.id, pastShipment: pastShipment.id, procuredOrderNumber: procured.number, procuredOrderToken: "browser-checks-paid-order", procuredOrder: procured.id, sentPo: sentPo.id, waitingPo: waitingPo.id, poToken, quote: review.id, quoteNumber: sent.number, quoteToken, rfqToken, business: business.id, product: product.id, productSlug: product.slug, supplier: supplier.id, category: category.id, columnsImport: columns.id, readyImport: ready.id, special: special.id, order: order.id, orderNumber: order.number, orderToken, portalOrder: portal.id, portalOrderNumber: portal.number, portalReturn: portalReturn.id, portalReturnNumber: portalReturn.number, portalList: portalList.id };
  } finally {
    await db.$disconnect();
  }
}
