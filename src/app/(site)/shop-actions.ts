"use server";

import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { requestContext, safeNext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { appKey } from "@/server/secrets";
import { check, enforce, hit, LIMITS } from "@/server/security/rate-limit";
import { addToCart, setQuantity } from "@/server/shop/cart";
import { currentCart, ensureCart } from "@/server/shop/cart-cookie";
import { placeOrder } from "@/server/shop/orders";
import { shopPrices, shopper } from "@/server/shop/viewer";

/** Adds a product or bundle and goes to the cart. Works without JavaScript. */
export async function addToCartAction(form: FormData) {
  const cartId = await ensureCart();
  const quantity = Math.max(1, Math.floor(Number(field(form, "quantity")) || 1));
  const productId = field(form, "productId") || undefined;
  const bundleId = field(form, "bundleId") || undefined;
  let back = "/cart?added=1";
  try {
    await addToCart(prisma, cartId, { productId, bundleId }, quantity, { trade: (await shopPrices()).trade });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    back = `/cart?problem=${encodeURIComponent(e.message)}`;
  }
  redirect(back);
}

export async function updateCartLineAction(form: FormData) {
  const cart = await currentCart();
  if (cart) await setQuantity(prisma, cart.id, field(form, "lineId"), field(form, "remove") ? 0 : Math.max(0, Math.floor(Number(field(form, "quantity")) || 0)), { trade: (await shopPrices()).trade });
  redirect(safeNext(field(form, "back"), "/cart"));
}

const CHECKOUT_FIELDS = ["email", "name", "phone", "fulfilment", "addressLine1", "addressLine2", "city", "postalCode", "collectionPointId", "paymentMethod", "customerReference", "notes"] as const;

export async function placeOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const values = Object.fromEntries(CHECKOUT_FIELDS.map((k) => [k, field(form, k)])) as Record<(typeof CHECKOUT_FIELDS)[number], string>;
  let done: { number: string; token: string } | null = null;
  const state = await run(async () => {
    const cart = await currentCart();
    if (!cart) throw new DomainError("invalid", "Your cart is empty.");
    const ctx = await requestContext();
    const ip = ctx.ipAddress ?? "unknown";
    await enforce(redis(), `checkout:${ip}`, LIMITS.checkoutPerIp);
    await check(redis(), `order:${ip}`, LIMITS.ordersPerIp);
    const [s, prices] = await Promise.all([shopper(), shopPrices()]);
    if (!s.user && !(await prisma.customerType.findUniqueOrThrow({ where: { code: "INDIVIDUAL" } })).guestCheckout) throw new DomainError("invalid", "Sign in or create an account to order.");
    const { order, token } = await placeOrder(prisma, { key: appKey() }, cart.id, prices, { userId: s.user?.id ?? null, organisationId: s.organisation?.id ?? null, role: s.organisation?.role ?? null }, values);
    done = { number: order.number, token };
    await hit(redis(), `order:${ip}`, LIMITS.ordersPerIp);
    if (order.status === "ON_ACCOUNT") await runSoon("procurement").catch(() => undefined);
    await runSoon("email-deliver").catch(() => undefined);
  }, values);
  if (done) {
    const { number, token } = done as { number: string; token: string };
    redirect(`/orders/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}&placed=1`);
  }
  return state;
}
