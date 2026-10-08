"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { createList, deleteList, listToCart, renameList, reorder, saveCartAsList, saveOrderAsList, saveToList, setListLine, type ToCart } from "@/server/portal/lists";
import { requestReturn, setInboundTracking, withdrawReturn } from "@/server/portal/returns";
import { portalViewer } from "@/server/portal/viewer";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { appKey } from "@/server/secrets";
import { check, hit, LIMITS } from "@/server/security/rate-limit";
import { currentCart, ensureCart } from "@/server/shop/cart-cookie";
import { shopPrices } from "@/server/shop/viewer";

/** Lists, buying again and returns, for the signed-in customer and what they buy for. */

function toCartPage(result: ToCart): string {
  const params = new URLSearchParams();
  if (result.added) params.set("added", String(result.added));
  if (result.skipped.length) params.set("problem", `Not added: ${result.skipped.join(" ")}`.slice(0, 600));
  return `/cart?${params.toString()}`;
}

/** Puts a past order's items back in the cart and goes to it. Works without JavaScript. */
export async function reorderAction(form: FormData) {
  const v = await portalViewer("/account/orders");
  const number = field(form, "orderNumber");
  let back: string;
  try {
    const cartId = await ensureCart();
    back = toCartPage(await reorder(prisma, v, number, cartId, { trade: (await shopPrices()).trade }));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    back = `/orders/${encodeURIComponent(number)}?problem=${encodeURIComponent(e.message)}`;
  }
  redirect(back);
}

export async function listToCartAction(form: FormData) {
  const v = await portalViewer("/account/lists");
  const listId = field(form, "listId");
  let back: string;
  try {
    const cartId = await ensureCart();
    back = toCartPage(await listToCart(prisma, v, listId, cartId, { trade: (await shopPrices()).trade }));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    back = `/account/lists/${encodeURIComponent(listId)}?problem=${encodeURIComponent(e.message)}`;
  }
  redirect(back);
}

export async function saveToListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { listId: field(form, "listId"), name: field(form, "name"), quantity: field(form, "quantity") || "1" };
  const v = await portalViewer(field(form, "back") || "/account/lists");
  const result = await run(async () => {
    const list = await saveToList(prisma, v, { listId: values.listId, newName: values.listId ? "" : values.name }, field(form, "productId"), values.quantity);
    return `Saved to ${list.name}.`;
  }, values);
  revalidatePath("/account/lists", "layout");
  return result;
}

export async function createListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name") };
  const v = await portalViewer("/account/lists");
  let created: string | null = null;
  const result = await run(async () => {
    created = (await createList(prisma, v, values.name)).id;
  }, values);
  if (created) redirect(`/account/lists/${created}`);
  return result;
}

export async function renameListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name") };
  const v = await portalViewer("/account/lists");
  const id = field(form, "listId");
  const result = await run(async () => {
    await renameList(prisma, v, id, values.name);
    return "Renamed.";
  }, values);
  revalidatePath(`/account/lists/${id}`);
  return result;
}

export async function deleteListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const v = await portalViewer("/account/lists");
  let done = false;
  const result = await run(async () => {
    await deleteList(prisma, v, field(form, "listId"));
    done = true;
  });
  if (done) redirect("/account/lists?deleted=1");
  return result;
}

export async function setListLineAction(_: ActionState, form: FormData): Promise<ActionState> {
  const v = await portalViewer("/account/lists");
  const result = await run(async () => {
    await setListLine(prisma, v, field(form, "lineId"), field(form, "remove") ? "0" : field(form, "quantity"));
    return field(form, "remove") ? "Removed." : "Saved.";
  });
  revalidatePath(`/account/lists/${field(form, "listId")}`);
  return result;
}

export async function saveCartAsListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name") };
  const v = await portalViewer("/cart");
  const result = await run(async () => {
    const cart = await currentCart();
    const list = await saveCartAsList(prisma, v, cart?.id ?? null, values.name);
    return `Saved as ${list.name}. Find it under Saved lists in your account.`;
  }, values);
  revalidatePath("/account/lists");
  return result;
}

export async function saveOrderAsListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name") };
  const number = field(form, "orderNumber");
  const v = await portalViewer(`/orders/${encodeURIComponent(number)}`);
  const result = await run(async () => {
    const list = await saveOrderAsList(prisma, v, number, values.name);
    return `Saved as ${list.name}. Find it under Saved lists in your account.`;
  }, values);
  revalidatePath("/account/lists");
  return result;
}

export async function requestReturnAction(_: ActionState, form: FormData): Promise<ActionState> {
  const number = field(form, "orderNumber");
  const v = await portalViewer(`/account/returns/new?order=${encodeURIComponent(number)}`);
  const quantities: Record<string, string> = {};
  for (const [k, val] of form.entries()) if (k.startsWith("qty-") && typeof val === "string") quantities[k.slice(4)] = val;
  const units = form.getAll("unit").filter((u): u is string => typeof u === "string");
  const values = { reason: field(form, "reason"), wants: field(form, "wants"), details: field(form, "details"), ...Object.fromEntries(Object.entries(quantities).map(([k, val]) => [`qty-${k}`, val])), ...Object.fromEntries(units.map((u) => [`unit-${u}`, "on"])) };
  let created: string | null = null;
  const result = await run(async () => {
    const { ipAddress } = await requestContext();
    await check(redis(), `return:${v.userId}`, LIMITS.returnsPerUser);
    created = (await requestReturn(prisma, { key: appKey() }, v, number, { reason: values.reason, wants: values.wants, details: values.details, quantities, units }, ipAddress)).number;
    await hit(redis(), `return:${v.userId}`, LIMITS.returnsPerUser);
  }, values);
  if (created) {
    await runSoon("email-deliver").catch(() => undefined);
    redirect(`/account/returns/${encodeURIComponent(created)}?sent=1`);
  }
  return result;
}

export async function withdrawReturnAction(_: ActionState, form: FormData): Promise<ActionState> {
  const v = await portalViewer("/account/returns");
  const number = field(form, "number");
  const result = await run(async () => {
    await withdrawReturn(prisma, v, number, (await requestContext()).ipAddress);
    return "Withdrawn.";
  });
  revalidatePath(`/account/returns/${encodeURIComponent(number)}`);
  return result;
}

export async function returnTrackingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const number = field(form, "number");
  const v = await portalViewer(`/account/returns/${encodeURIComponent(number)}`);
  const values = { carrier: field(form, "carrier"), reference: field(form, "reference") };
  const result = await run(async () => {
    await setInboundTracking(prisma, v, number, values, (await requestContext()).ipAddress);
    return "Thank you. We look out for it.";
  }, values);
  revalidatePath(`/account/returns/${encodeURIComponent(number)}`);
  return result;
}
