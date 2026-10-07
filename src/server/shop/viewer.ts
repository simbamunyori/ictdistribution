import "server-only";
import type { CustomerTypeCode } from "@prisma/client";
import { cache } from "react";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { currentMarket } from "@/server/markets/current";
import { priceContext } from "./prices";

/**
 * Who is shopping, read once per request: the signed-in customer (and the
 * organisation they act for), their customer type and their market.
 */
export const shopper = cache(async () => {
  const [{ market }, session] = await Promise.all([currentMarket(), currentSession("CUSTOMER")]);
  const signedIn = session?.stage === "ACTIVE" ? session : null;
  let customerType: CustomerTypeCode = "INDIVIDUAL";
  let organisation: { id: string; name: string } | null = null;
  if (signedIn?.activeOrganisationId) {
    const org = await prisma.organisation.findUnique({ where: { id: signedIn.activeOrganisationId }, select: { id: true, name: true, customerType: true } });
    if (org) {
      customerType = org.customerType;
      organisation = { id: org.id, name: org.name };
    }
  }
  return { market, session: signedIn, user: signedIn?.user ?? null, customerType, organisation };
});

/** Prices for this request's shopper. */
export const shopPrices = cache(async () => {
  const s = await shopper();
  return priceContext(prisma, s.market, s.customerType);
});
