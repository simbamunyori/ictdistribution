import "server-only";
import type { CustomerTypeCode, OrgRole, VerificationStatus } from "@prisma/client";
import { cache } from "react";
import type { Standing } from "@/lib/standing";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { currentMarket } from "@/server/markets/current";
import { priceContext } from "./prices";

/**
 * Who is shopping, read once per request: the signed-in customer (and the
 * organisation they act for), the price level they buy at and their
 * market. An organisation buys at its own level only once we have
 * approved it; until then it buys at Individual prices.
 */
export const shopper = cache(async () => {
  const [{ market }, session] = await Promise.all([currentMarket(), currentSession("CUSTOMER")]);
  const signedIn = session?.stage === "ACTIVE" ? session : null;
  let customerType: CustomerTypeCode = "INDIVIDUAL";
  let organisation: { id: string; name: string; verification: VerificationStatus; role: OrgRole } | null = null;
  if (signedIn?.activeOrganisationId) {
    const m = await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId: signedIn.activeOrganisationId, userId: signedIn.userId } },
      select: { active: true, role: true, organisation: { select: { id: true, name: true, customerType: true, verification: true } } },
    });
    if (m?.active) {
      const org = m.organisation;
      if (org.verification === "APPROVED") customerType = org.customerType;
      organisation = { id: org.id, name: org.name, verification: org.verification, role: m.role };
    }
  }
  const standing: Standing = !organisation ? "retail" : organisation.verification === "APPROVED" ? "trade" : "unverified";
  return { market, session: signedIn, user: signedIn?.user ?? null, customerType, organisation, standing };
});

/** Prices for this request's shopper. */
export const shopPrices = cache(async () => {
  const s = await shopper();
  return priceContext(prisma, s.market, s.customerType, new Date(), s.customerType === "INDIVIDUAL" ? null : (s.organisation?.id ?? null));
});

/** How prices read for this request's shopper. */
export const shopWhere = cache(async () => {
  const s = await shopper();
  return { locale: s.market.locale, timeZone: s.market.timeZone, standing: s.standing };
});
