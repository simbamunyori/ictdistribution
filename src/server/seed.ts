import type { PrismaClient } from "@prisma/client";
import { mpnKey, searchTextFor, slugify, type SpecValues } from "@/lib/catalogue";
import { seedStarterCategories } from "./catalogue/starter";
import { DEMO_EMAILS, DEMO_SUFFIX } from "./placeholders";

/**
 * The starting rows every server needs: currencies, the three launch
 * markets, the four customer types and the pricing settings. Safe to run
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
        { code: "bw", name: "Botswana", country: "BW", currency: "BWP", locale: "en-BW", timeZone: "Africa/Gaborone", enabled: true, isDefault: true, sortOrder: 10, fxBufferBps: 200, roundToMinor: 100 },
        { code: "za", name: "South Africa", country: "ZA", currency: "ZAR", locale: "en-ZA", timeZone: "Africa/Johannesburg", enabled: true, sortOrder: 20, fxBufferBps: 200, roundToMinor: 100 },
        // Zimbabwe trades in US dollars, so no conversion and no buffer; prices round to the dollar.
        { code: "zw", name: "Zimbabwe", country: "ZW", currency: "USD", locale: "en-ZW", timeZone: "Africa/Harare", enabled: true, sortOrder: 30, fxBufferBps: 0, roundToMinor: 100 },
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
  added.push(...(await seedDemoCatalogue(db)));
  return added;
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
