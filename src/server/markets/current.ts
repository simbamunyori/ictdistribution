import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { chooseMarket, MARKET_COOKIE } from "@/lib/markets";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { cachedMarkets } from "./markets";

/** Cloudflare sends "XX" when it can't tell and "T1" for Tor; both count as unknown. */
export function countryFromHeader(value: string | null | undefined): string | undefined {
  const v = value?.trim().toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" ? v : undefined;
}

/**
 * The market this request is priced in: the signed-in customer's (their
 * organisation's, or their own), else the one they picked, else their
 * country's, else the default. Read once per request.
 */
export const currentMarket = cache(async () => {
  const markets = await cachedMarkets(prisma);
  const session = await currentSession("CUSTOMER");
  let account: string | null | undefined = session?.user.marketCode;
  if (session?.activeOrganisationId) {
    account = (await prisma.organisation.findUnique({ where: { id: session.activeOrganisationId }, select: { marketCode: true } }))?.marketCode;
  }
  const cookie = (await cookies()).get(MARKET_COOKIE)?.value;
  const country = countryFromHeader((await headers()).get(env().GEO_COUNTRY_HEADER));
  return { ...chooseMarket(markets, { account, cookie, country }), markets: markets.filter((m) => m.enabled) };
});
