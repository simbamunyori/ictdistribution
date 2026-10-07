import type { PrismaClient } from "@prisma/client";
import { mpnKey, searchTextFor, slugify, type SpecValues } from "@/lib/catalogue";
import { seedStarterCategories } from "./catalogue/starter";
import { DEMO_EMAILS, DEMO_MPN, DEMO_SUFFIX } from "./placeholders";
import { refreshCosts } from "./shop/costs";

/**
 * The starting rows every server needs: currencies, the three launch
 * markets (with their standard VAT rates), the four customer types, and
 * the pricing and shop settings. Safe to run
 * on every start: it only adds what is missing and never changes what
 * staff have edited since.
 *
 * The markups are starting values until the business decides them
 * (docs/ICTD_BUILD.md, decision 2); staff change them at /admin/customer-types.
 */
export async function seedReferenceData(db: PrismaClient): Promise<string[]> {
  const added: string[] = [];
  const currencies = [
    { code: "USD", name: "US dollar" },
    { code: "BWP", name: "Botswana pula" },
    { code: "ZAR", name: "South African rand" },
  ];
  for (const c of currencies) {
    if (!(await db.currency.findUnique({ where: { code: c.code } }))) {
      await db.currency.create({ data: c });
      added.push(`currency ${c.code}`);
    }
  }

  if (!(await db.market.count())) {
    await db.market.createMany({
      data: [
        { code: "bw", name: "Botswana", country: "BW", currency: "BWP", locale: "en-BW", timeZone: "Africa/Gaborone", enabled: true, isDefault: true, sortOrder: 10, fxBufferBps: 200, roundToMinor: 100, taxRateBps: 1400 },
        { code: "za", name: "South Africa", country: "ZA", currency: "ZAR", locale: "en-ZA", timeZone: "Africa/Johannesburg", enabled: true, sortOrder: 20, fxBufferBps: 200, roundToMinor: 100, taxRateBps: 1500 },
        // Zimbabwe trades in US dollars, so no conversion and no buffer; prices round to the dollar.
        { code: "zw", name: "Zimbabwe", country: "ZW", currency: "USD", locale: "en-ZW", timeZone: "Africa/Harare", enabled: true, sortOrder: 30, fxBufferBps: 0, roundToMinor: 100, taxRateBps: 1550 },
      ],
    });
    added.push("markets bw, za, zw");
  }

  const types = [
    { code: "INDIVIDUAL" as const, name: "Individual", description: "People and small buyers in the shop. Retail prices.", markupBps: 2500, organisation: false, guestCheckout: true, sortOrder: 10 },
    { code: "BUSINESS" as const, name: "Business", description: "Registered companies buying for their own use.", markupBps: 1800, organisation: true, guestCheckout: false, sortOrder: 20 },
    { code: "RESELLER" as const, name: "Reseller", description: "IT resellers and systems integrators buying to resell.", markupBps: 1200, organisation: true, guestCheckout: false, sortOrder: 30 },
    { code: "GOVERNMENT" as const, name: "Government and enterprise", description: "Government departments, parastatals and large enterprises, often by tender.", markupBps: 1500, organisation: true, guestCheckout: false, sortOrder: 40 },
  ];
  for (const t of types) {
    if (!(await db.customerType.findUnique({ where: { code: t.code } }))) {
      await db.customerType.create({ data: t });
      added.push(`customer type ${t.name}`);
    }
  }

  if (!(await db.pricingSettings.findUnique({ where: { id: "global" } }))) {
    await db.pricingSettings.create({ data: { id: "global" } });
    added.push("pricing settings");
  }
  if (!(await db.shopSettings.findUnique({ where: { id: "global" } }))) {
    await db.shopSettings.create({ data: { id: "global" } });
    added.push("shop settings");
  }
  if (!(await db.quoteSettings.findUnique({ where: { id: "global" } }))) {
    await db.quoteSettings.create({ data: { id: "global" } });
    added.push("quote rules");
  }
  if (!(await db.procurementSettings.findUnique({ where: { id: "global" } }))) {
    await db.procurementSettings.create({ data: { id: "global" } });
    added.push("purchase order rules");
  }
  added.push(...(await seedStarterCategories(db)));
  return added;
}

/** Demo customers for development and the browser checks. Never in production unless SEED_DEMO=yes. */
export async function seedDemo(db: PrismaClient): Promise<string[]> {
  const added: string[] = [];
  const [individual, owner, buyer, staff] = DEMO_EMAILS;
  if (!(await db.user.findUnique({ where: { email: individual } }))) {
    await db.user.create({ data: { email: individual, name: "Neo Demo", marketCode: "bw", emailVerifiedAt: new Date() } });
    added.push(individual);
  }
  if (!(await db.user.findUnique({ where: { email: owner } }))) {
    const org = await db.organisation.create({ data: { name: "Kgale Hill Systems (demo)", customerType: "RESELLER", country: "BW", marketCode: "bw", registrationNumber: "BW00000000000" } });
    const o = await db.user.create({ data: { email: owner, name: "Kabo Demo", marketCode: "bw", emailVerifiedAt: new Date() } });
    const b = await db.user.create({ data: { email: buyer, name: "Lesego Demo", marketCode: "bw", emailVerifiedAt: new Date() } });
    await db.membership.createMany({ data: [{ organisationId: org.id, userId: o.id, role: "OWNER" }, { organisationId: org.id, userId: b.id, role: "BUYER" }] });
    added.push(`${org.name} with ${owner} and ${buyer}`);
  }
  // The demo business is checked and has demo credit, so trade prices and buying on account can be tried.
  const demoOrg = await db.organisation.findFirst({ where: { name: "Kgale Hill Systems (demo)", verification: "NOT_SUBMITTED" } });
  if (demoOrg) {
    await db.organisation.update({
      where: { id: demoOrg.id },
      data: { taxNumber: "C00000000000", address: "Plot 1 (demo), Gaborone", directors: "Kabo Demo", verification: "APPROVED", submittedAt: new Date(), verifiedAt: new Date(), verifiedByLabel: "Seed", creditLimitMinor: 250_000_00n, creditTermsDays: 30 },
    });
    added.push(`${demoOrg.name} approved, with demo credit of 250,000.00 on 30 days`);
  }
  // A demo Admin for the browser checks. With no passkey, a real sign-in stops at adding one.
  if (!(await db.user.findUnique({ where: { email: staff } }))) {
    await db.user.create({ data: { kind: "STAFF", email: staff, name: "Thabo Demo", staffRole: "ADMIN", emailVerifiedAt: new Date() } });
    added.push(`${staff} (staff Admin)`);
  }
  // Demo rates, so prices show before the first fetch. Marked as seeded, so staff can see them for what they are.
  for (const [quote, rate] of [["BWP", "13.65"], ["ZAR", "18.20"]] as const) {
    if (!(await db.exchangeRate.findFirst({ where: { base: "USD", quote } }))) {
      await db.exchangeRate.create({ data: { base: "USD", quote, rate, source: "seed", publishedAt: new Date() } });
      added.push(`demo rate USD to ${quote}`);
    }
  }
  // Where suppliers deliver, marked as a demo so the start-up check flags it on a real server.
  const procurement = await db.procurementSettings.findUnique({ where: { id: "global" } });
  if (procurement && !procurement.deliverTo) {
    await db.procurementSettings.update({ where: { id: "global" }, data: { deliverTo: "ICT Distribution warehouse (demo)\nPlot 1, Gaborone West Industrial, Gaborone\nReceiving: Thabo Demo, +267 71 000 000", paymentTerms: "30 days from invoice" } });
    added.push("demo delivery address for purchase orders");
  }
  added.push(...(await seedDemoCatalogue(db)));
  added.push(...(await seedDemoShop(db)));
  added.push(...(await seedDemoSupplierCategories(db)));
  return added;
}

/**
 * The shop set up for Botswana, with demo values marked "(demo)": bank
 * details, delivery, a collection point, featured products and three
 * specials (a product, a category and a bundle). The start-up check
 * flags the bank details and collection point on a real server.
 */
async function seedDemoShop(db: PrismaClient): Promise<string[]> {
  await refreshCosts(db);
  if (await db.collectionPoint.count({ where: { name: { endsWith: DEMO_SUFFIX } } })) return [];
  await db.market.update({
    where: { code: "bw" },
    data: { bankDetails: `First Demo Bank ${DEMO_SUFFIX}\nAccount name: ICT Distribution Africa\nAccount number: 0000000000\nBranch code: 000000`, deliveryEnabled: true, deliveryFeeMinor: 8000n, freeDeliveryMinor: 500000n, deliveryNote: "1 to 3 working days in Gaborone, 3 to 5 elsewhere." },
  });
  await db.collectionPoint.create({ data: { marketCode: "bw", name: `Gaborone office ${DEMO_SUFFIX}`, address: "Plot 0000, Main Mall, Gaborone", hours: "Monday to Friday, 08:00 to 17:00" } });
  const demo = await db.product.findMany({ where: { mpnKey: { startsWith: DEMO_MPN } }, select: { id: true, mpn: true, categoryId: true } });
  const by = (mpn: string) => demo.find((p) => p.mpn === mpn);
  for (const [i, mpn] of ["DEMO-21M7001", "DEMO-SM-A556E", "DEMO-P2425H", "DEMO-85B12EA"].entries()) {
    const p = by(mpn);
    if (p) await db.featuredProduct.upsert({ where: { productId: p.id }, create: { productId: p.id, sortOrder: (i + 1) * 10 }, update: {} });
  }
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const laptop = by("DEMO-21M7001");
  const memory = by("DEMO-KVR56S46BS8-16");
  const monitor = by("DEMO-P2425H");
  const all = { startsAt: new Date(now - day), customerTypes: ["INDIVIDUAL" as const, "BUSINESS" as const, "RESELLER" as const, "GOVERNMENT" as const] };
  if (laptop) await db.special.create({ data: { ...all, slug: "demo-thinkpad-launch", name: `ThinkPad launch price ${DEMO_SUFFIX}`, description: "Our first consignment, while stock lasts.", kind: "PRODUCT", discountBps: 1000, endsAt: new Date(now + 10 * day), quantityLimit: 12, perOrderLimit: 2, featured: true, items: { create: [{ productId: laptop.id }] } } });
  if (monitor) await db.special.create({ data: { ...all, slug: "demo-monitor-week", name: `Monitor week ${DEMO_SUFFIX}`, description: "5% off every monitor.", kind: "CATEGORY", categoryId: monitor.categoryId, discountBps: 500, endsAt: new Date(now + 5 * day), featured: true } });
  if (laptop && memory) await db.special.create({ data: { ...all, slug: "demo-laptop-memory-bundle", name: `ThinkPad with 16 GB more memory ${DEMO_SUFFIX}`, description: "The laptop and a second 16 GB stick, together.", kind: "BUNDLE", discountBps: 800, endsAt: new Date(now + 20 * day), quantityLimit: 5, featured: true, items: { create: [{ productId: laptop.id }, { productId: memory.id }] } } });
  return ["demo shop for Botswana: bank details, delivery, a collection point, featured products and three specials"];
}

/** What the demo suppliers supply, so quotes for items we don't list can ask them for prices. */
async function seedDemoSupplierCategories(db: PrismaClient): Promise<string[]> {
  const suppliers = await db.supplier.findMany({ where: { name: { endsWith: DEMO_SUFFIX } }, orderBy: { name: "asc" }, include: { _count: { select: { categories: true } } } });
  if (!suppliers.length || suppliers.some((x) => x._count.categories)) return [];
  const categories = await db.category.findMany({ where: { slug: { in: ["laptops", "phones", "monitors", "memory", "networking"] } }, select: { id: true, slug: true } });
  const pick = (...slugs: string[]) => categories.filter((c) => slugs.includes(c.slug));
  const [local, china] = [suppliers.find((x) => x.kind === "LOCAL"), suppliers.find((x) => x.kind === "CHINA")];
  if (local) await db.supplierCategory.createMany({ data: pick("laptops", "monitors", "memory", "networking").map((c) => ({ supplierId: local.id, categoryId: c.id })), skipDuplicates: true });
  if (china) await db.supplierCategory.createMany({ data: pick("laptops", "phones", "memory").map((c) => ({ supplierId: china.id, categoryId: c.id })), skipDuplicates: true });
  return ["categories for the demo suppliers"];
}

const DEMO_PRODUCTS: { category: string; brand: string; name: string; mpn: string; summary: string; specs: SpecValues; individuals: boolean; warranty: number; offers: [supplier: number, cost: string, lead: number | null, stock: number | null][] }[] = [
  { category: "laptops", brand: "Lenovo", name: "ThinkPad E14 Gen 6, Core i5, 16 GB, 512 GB", mpn: "DEMO-21M7001", summary: "A dependable 14 inch business laptop.", specs: { processor: "Intel Core i5-1335U", memory_gb: 16, memory_type: "DDR5", storage_gb: 512, storage_type: "SSD", screen_in: 14, os: "Windows 11 Pro", touchscreen: false, weight_kg: 1.44 }, individuals: true, warranty: 12, offers: [[0, "13500.00", 3, 12], [1, "689.00", 21, null]] },
  { category: "laptops", brand: "HP", name: "ProBook 450 G10, Core i7, 16 GB, 1 TB", mpn: "DEMO-85B12EA", summary: "A 15.6 inch laptop for the office and the road.", specs: { processor: "Intel Core i7-1355U", memory_gb: 16, memory_type: "DDR4", storage_gb: 1024, storage_type: "SSD", screen_in: 15.6, os: "Windows 11 Pro", touchscreen: false, weight_kg: 1.79 }, individuals: true, warranty: 12, offers: [[0, "17900.00", 5, 4]] },
  { category: "phones", brand: "Samsung", name: "Galaxy A55 5G, 256 GB", mpn: "DEMO-SM-A556E", summary: "A 6.6 inch phone with a long-lasting battery.", specs: { storage_gb: 256, memory_gb: 8, screen_in: 6.6, os: "Android", network: "5G", dual_sim: true, colour: "Navy" }, individuals: true, warranty: 24, offers: [[0, "7200.00", 2, 30], [1, "339.00", 18, null]] },
  { category: "monitors", brand: "Dell", name: "P2425H 24 inch monitor", mpn: "DEMO-P2425H", summary: "A height-adjustable 24 inch office monitor.", specs: { screen_in: 23.8, resolution: "1920 x 1080", refresh_hz: 100, panel: "IPS", usb_c: false, height_adjustable: true }, individuals: true, warranty: 36, offers: [[0, "3100.00", 4, 20]] },
  { category: "memory", brand: "Kingston", name: "16 GB DDR5 5600 SO-DIMM", mpn: "DEMO-KVR56S46BS8-16", summary: "Laptop memory.", specs: { capacity_gb: 16, memory_type: "DDR5", module: "SO-DIMM", speed_mts: 5600 }, individuals: true, warranty: 120, offers: [[0, "780.00", 2, 50], [1, "38.50", 18, null]] },
  { category: "memory", brand: "Kingston", name: "16 GB DDR4 3200 SO-DIMM", mpn: "DEMO-KVR32S22S8-16", summary: "Laptop memory.", specs: { capacity_gb: 16, memory_type: "DDR4", module: "SO-DIMM", speed_mts: 3200 }, individuals: true, warranty: 120, offers: [[0, "640.00", 2, 50]] },
  { category: "switches", brand: "TP-Link", name: "Omada 24-port gigabit smart switch with 4 SFP", mpn: "DEMO-SG2428P", summary: "A 24-port PoE+ switch for small offices.", specs: { ports: 24, port_speed: "1 Gb", management: "Smart", poe: true }, individuals: false, warranty: 60, offers: [[0, "6900.00", 5, 6], [1, "319.00", 25, null]] },
];

/**
 * Two demo suppliers and a few demo products with offers, for development
 * and the browser checks. Part numbers start with DEMO and supplier names
 * end with (demo), so the start-up check finds them on a real server.
 */
async function seedDemoCatalogue(db: PrismaClient): Promise<string[]> {
  if (await db.supplier.count({ where: { name: { endsWith: DEMO_SUFFIX } } })) return [];
  const suppliers = [
    await db.supplier.create({ data: { name: `Gaborone Distribution ${DEMO_SUFFIX}`, kind: "LOCAL", country: "ZA", currency: "ZAR", email: "sales@example.co.za", leadTimeDays: 4, landedCostBps: 500, preferred: true } }),
    await db.supplier.create({ data: { name: `Shenzhen Trading ${DEMO_SUFFIX}`, kind: "CHINA", country: "CN", currency: "USD", whatsapp: "+8613800000000", leadTimeDays: 21, landedCostBps: 1800 } }),
  ];
  const categories = new Map((await db.category.findMany({ select: { id: true, slug: true, name: true, parent: { select: { name: true } } } })).map((c) => [c.slug, c]));
  let made = 0;
  for (const p of DEMO_PRODUCTS) {
    const category = categories.get(p.category);
    if (!category) continue;
    const brand = (await db.brand.findUnique({ where: { name: p.brand } })) ?? (await db.brand.create({ data: { name: p.brand, slug: slugify(p.brand) } }));
    const product = await db.product.create({
      data: {
        slug: slugify(`${p.brand} ${p.name}`),
        name: p.name,
        brandId: brand.id,
        mpn: p.mpn,
        mpnKey: mpnKey(p.mpn),
        categoryId: category.id,
        summary: p.summary,
        specs: p.specs,
        warrantyMonths: p.warranty,
        warrantyTerms: "Manufacturer, carry-in",
        sellToIndividuals: p.individuals,
        status: "ACTIVE",
        searchText: searchTextFor({ name: p.name, brand: p.brand, mpn: p.mpn, category: [category.parent?.name, category.name].filter(Boolean).join(" "), specs: p.specs, summary: p.summary }),
      },
    });
    for (const [i, cost, lead, stock] of p.offers) {
      const s = suppliers[i];
      const [whole, frac = ""] = cost.split(".");
      await db.supplierOffer.create({ data: { supplierId: s.id, productId: product.id, costMinor: BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2)), currency: s.currency, leadTimeDays: lead, stock, source: "staff", priceUpdatedAt: new Date() } });
    }
    made++;
  }
  await db.supplierEvent.create({ data: { supplierId: suppliers[0].id, kind: "ON_TIME", occurredAt: new Date(), note: "Demo delivery.", recordedByLabel: "Seed" } });
  return [`demo suppliers and ${made} demo products`];
}
