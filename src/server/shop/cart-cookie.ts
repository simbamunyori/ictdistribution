import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { cartCount, cartFor, findCart } from "./cart";

/** __Host- in production, like the session cookies: HTTPS, this host, path "/". */
export const CART_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ictd_cart" : "ictd_cart";

async function token() {
  return (await cookies()).get(CART_COOKIE)?.value;
}

/** This visitor's cart, if they have one. */
export async function currentCart() {
  return findCart(prisma, await token());
}

/** This visitor's cart, made (and its cookie set) if they have none. Only in a server action. */
export async function ensureCart() {
  const c = await cartFor(prisma, await token());
  if (c.created) (await cookies()).set(CART_COOKIE, c.token, { path: "/", maxAge: 60 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true });
  return c.id;
}

export async function currentCartCount() {
  const cart = await currentCart();
  return cartCount(prisma, cart?.id);
}
