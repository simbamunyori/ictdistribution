"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COMPARE_COOKIE, MAX_COMPARE, readCompare } from "@/lib/catalogue";
import { safeNext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { IN_SHOP } from "@/server/catalogue/shop";

/**
 * Adds a product to the comparison, or takes it out. Kept in a cookie, so
 * it works without an account and without JavaScript. Adding a fifth
 * drops the first one added.
 */
export async function toggleCompareAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const jar = await cookies();
  let ids = readCompare(jar.get(COMPARE_COOKIE)?.value);
  if (ids.includes(id)) ids = ids.filter((x) => x !== id);
  else if (await prisma.product.findFirst({ where: { AND: [IN_SHOP, { id }] }, select: { id: true } })) ids = [...ids, id].slice(-MAX_COMPARE);
  jar.set(COMPARE_COOKIE, ids.join(","), { path: "/", maxAge: 30 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true });
  redirect(safeNext(String(form.get("back") ?? "/compare"), "/compare"));
}

export async function clearCompareAction() {
  (await cookies()).delete(COMPARE_COOKIE);
  redirect("/compare");
}
