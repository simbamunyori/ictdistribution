import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Addresses of seeded records for the pages that need an id: a demo
 * product, supplier and category, two demo price lists (one waiting
 * for its columns, one ready for review), a demo special and a demo
 * order with a known link, made here when missing.
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
    let order = await db.order.findUnique({ where: { number: "ICT-TEST-1" } });
    order ??= await db.order.create({
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
    });
    return { product: product.id, productSlug: product.slug, supplier: supplier.id, category: category.id, columnsImport: columns.id, readyImport: ready.id, special: special.id, order: order.id, orderNumber: order.number, orderToken };
  } finally {
    await db.$disconnect();
  }
}
