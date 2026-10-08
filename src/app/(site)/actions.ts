"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MARKET_COOKIE } from "@/lib/markets";
import { audit } from "@/server/audit";
import { authDeps, clearSessionCookie, currentSession, readSessionToken, safeNext } from "@/server/auth/next";
import { signOut } from "@/server/auth/service";
import { prisma } from "@/server/db";

/** The visitor picks the country they buy in. A signed-in individual's account moves with it. */
export async function chooseMarketAction(form: FormData) {
  const code = String(form.get("market") ?? "");
  const market = await prisma.market.findFirst({ where: { code, enabled: true } });
  if (market) {
    (await cookies()).set(MARKET_COOKIE, market.code, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true });
    const session = await currentSession("CUSTOMER");
    if (session?.stage === "ACTIVE" && !session.activeOrganisationId && session.user.marketCode !== market.code) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: session.userId }, data: { marketCode: market.code } });
        await audit(tx, { actorKind: "CUSTOMER", actorUserId: session.userId, actorLabel: session.user.name, subjectUserId: session.userId, action: "account.market-changed", summary: `Now buying in ${market.name}`, visibleToCustomer: true });
      });
    }
  }
  redirect(safeNext(String(form.get("back") ?? "/"), "/"));
}

export async function signOutAction() {
  await signOut(authDeps(), await readSessionToken("CUSTOMER"));
  await clearSessionCookie("CUSTOMER");
  redirect("/");
}
