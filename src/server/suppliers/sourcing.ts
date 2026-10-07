import type { PrismaClient, SourcingRule } from "@prisma/client";
import { customerPrice } from "@/lib/pricing";
import { chooseOffer, resolveRule, SOURCING_RULE_LABEL } from "@/lib/sourcing";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Which supplier we buy a product from, and what that makes our cost.
 * The rule comes from the product, else its category, else the parent
 * category, else the global setting at /admin/sourcing.
 */

export async function productSourcing(db: PrismaClient, productId: string) {
  const [product, settings] = await Promise.all([
    db.product.findUnique({
      where: { id: productId },
      select: { sourcingRule: true, category: { select: { sourcingRule: true, name: true, parent: { select: { sourcingRule: true, name: true } } } }, offers: { include: { supplier: true }, orderBy: { costMinor: "asc" } } },
    }),
    pricingSettings(db),
  ]);
  if (!product) throw new DomainError("not-found", "No such product.");
  const rates = await currentRates(db, settings.baseCurrency);
  const rule = resolveRule(product.sourcingRule, product.category.sourcingRule, product.category.parent?.sourcingRule, settings.sourcingRule);
  const ruleFrom = product.sourcingRule ? "this product" : product.category.sourcingRule ? product.category.name : product.category.parent?.sourcingRule ? product.category.parent.name : "the default";
  const choice = chooseOffer(product.offers, rule, settings.baseCurrency, (c) => asRate(rates.get(c)));
  return { ...choice, ruleFrom, base: settings.baseCurrency };
}

/**
 * What each customer type would pay in each market, from the chosen
 * supplier's landed cost. For staff only; the shop shows its own prices
 * from D3.
 */
export async function pricePreview(db: PrismaClient, productId: string) {
  const s = await productSourcing(db, productId);
  if (!s.chosen?.landed) return null;
  const [types, markets, rates] = await Promise.all([db.customerType.findMany({ orderBy: { sortOrder: "asc" } }), db.market.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }), currentRates(db, s.base)]);
  const cost = s.chosen.landed;
  return {
    cost,
    markets,
    rows: types.map((t) => ({
      type: t.name,
      prices: markets.map((m) => {
        try {
          return customerPrice(cost, t.markupBps, m, m.currency === cost.currency ? null : asRate(rates.get(m.currency)));
        } catch {
          return null;
        }
      }),
    })),
  };
}

export async function setDefaultRule(db: PrismaClient, actor: StaffActor, rule: SourcingRule, ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  if (!(rule in SOURCING_RULE_LABEL)) throw new DomainError("invalid", "Choose a rule.", "rule");
  await db.$transaction(async (tx) => {
    const before = await pricingSettings(tx);
    await tx.pricingSettings.update({ where: { id: "global" }, data: { sourcingRule: rule } });
    if (before.sourcingRule !== rule) await audit(tx, staffAudit(actor, { action: "sourcing.default", summary: `Changed the default supplier rule from ${SOURCING_RULE_LABEL[before.sourcingRule]} to ${SOURCING_RULE_LABEL[rule]}`, ipAddress: ip }));
  });
}

/** Categories with their own rule, for the sourcing page. */
export async function categoryRules(db: Pick<PrismaClient, "category">) {
  return db.category.findMany({ where: { sourcingRule: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, sourcingRule: true, parent: { select: { name: true } } } });
}

export async function productRules(db: Pick<PrismaClient, "product">) {
  return db.product.findMany({ where: { sourcingRule: { not: null } }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, sourcingRule: true, brand: { select: { name: true } } } });
}
