import type { PrismaClient } from "@prisma/client";
import { DEMO_EMAILS } from "./placeholders";

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
  return added;
}
