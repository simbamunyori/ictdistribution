import type { PrismaClient } from "@prisma/client";
import { chooseOffer, resolveRule } from "@/lib/sourcing";
import { landedAdder, landedContext } from "@/server/logistics/landed";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";

/**
 * Keeps each product's landed cost (and lead time) in step with its
 * offers, the sourcing rules, the exchange rates and the freight and
 * duty estimates, so shop pages price
 * products without reading offers. Internal: the shop shows prices made
 * from it, never the cost.
 *
 * Runs after anything that changes offers or rules, and every hour after
 * the rates, for everything.
 */
export async function refreshCosts(db: PrismaClient, productIds?: string[], now = new Date()): Promise<number> {
  const settings = await pricingSettings(db);
  const rates = await currentRates(db, settings.baseCurrency);
  const rate = (c: string) => asRate(rates.get(c));
  const logistics = await landedContext(db);
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.product.findMany({
      where: productIds ? { id: { in: productIds } } : {},
      select: {
        id: true,
        sourcingRule: true,
        landedCostMinor: true,
        leadTimeDays: true,
        weightGrams: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
        categoryId: true,
        category: { select: { sourcingRule: true, parentId: true, parent: { select: { sourcingRule: true } } } },
        offers: { include: { supplier: true } },
      },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) break;
    for (const p of batch) {
      const rule = resolveRule(p.sourcingRule, p.category.sourcingRule, p.category.parent?.sourcingRule, settings.sourcingRule);
      const chosen = chooseOffer(p.offers, rule, settings.baseCurrency, rate, landedAdder(logistics, { ...p, parentCategoryId: p.category.parentId })).chosen;
      const landed = chosen?.landed?.amountMinor ?? null;
      const lead = chosen ? chosen.leadTimeDays : null;
      if (landed !== p.landedCostMinor || lead !== p.leadTimeDays) {
        await db.product.update({ where: { id: p.id }, data: { landedCostMinor: landed, leadTimeDays: lead, costRefreshedAt: now } });
        changed++;
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 500) break;
  }
  return changed;
}
