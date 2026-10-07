import { PrismaClient } from "@prisma/client";

/**
 * Addresses of seeded records for the pages that need an id: a demo
 * product, supplier and category, and two demo price lists (one waiting
 * for its columns, one ready for review), made here when missing.
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
    return { product: product.id, productSlug: product.slug, supplier: supplier.id, category: category.id, columnsImport: columns.id, readyImport: ready.id };
  } finally {
    await db.$disconnect();
  }
}
