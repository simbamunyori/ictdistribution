"use server";

import type { SpecialKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { appKey } from "@/server/secrets";
import { cancelOrder, fulfilOrder, recordPayment } from "@/server/shop/orders";
import { addCollectionPoint, addFeatured, moveFeaturedUp, productByReference, removeFeatured, setCollectionPointActive, updateMarketDelivery, updateMarketTaxAndBank, updateShopSettings } from "@/server/shop/settings";
import { createSpecial, endSpecial, launchConsignment, updateSpecial, type SpecialInput } from "@/server/shop/specials";
import { staff } from "./staff-actor";

/**
 * Admin actions for the shop: specials, the home page, selling settings
 * per market and orders. Each checks the session again; the service
 * checks the role and writes the audit row.
 */

const on = (form: FormData, key: string) => form.get(key) === "on";
const pick = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(form, k)]));

// ─── Specials ────────────────────────────────────────────────────────

const BUNDLE_SLOTS = 6;
const SPECIAL_FIELDS = ["name", "description", "kind", "categoryId", "mode", "percent", "price", "marketCode", "startsAt", "endsAt", "quantityLimit", "perOrderLimit"];
const ITEM_FIELDS = Array.from({ length: BUNDLE_SLOTS }, (_, i) => [`item${i}Ref`, `item${i}Qty`]).flat();

/** Bundle and product items are typed as part numbers; this turns them into products. */
async function itemsOf(form: FormData, kind: string) {
  if (kind === "CATEGORY") return [];
  const slots = kind === "PRODUCT" ? 1 : BUNDLE_SLOTS;
  const items: { productId: string; quantity: number }[] = [];
  for (let i = 0; i < slots; i++) {
    const ref = field(form, `item${i}Ref`).trim();
    if (!ref) continue;
    const p = await productByReference(prisma, ref, "items");
    items.push({ productId: p.id, quantity: kind === "PRODUCT" ? 1 : Number(field(form, `item${i}Qty`) || "1") });
  }
  return items;
}

function specialFields(form: FormData): Omit<SpecialInput, "kind" | "items"> {
  const v = pick(form, SPECIAL_FIELDS);
  return {
    name: v.name,
    description: v.description,
    categoryId: v.categoryId,
    mode: v.mode,
    percent: v.percent,
    price: v.price,
    marketCode: v.marketCode,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    quantityLimit: v.quantityLimit,
    perOrderLimit: v.perOrderLimit,
    customerTypes: form.getAll("customerTypes").map(String),
    featured: on(form, "featured"),
    active: on(form, "active"),
  };
}

export async function specialAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = { ...pick(form, [...SPECIAL_FIELDS, ...ITEM_FIELDS]), customerTypes: form.getAll("customerTypes").map(String).join(","), featured: on(form, "featured") ? "on" : "", active: on(form, "active") ? "on" : "" };
  let created = "";
  const result = await run(async () => {
    const kind = field(form, "kind") as SpecialKind;
    const input: SpecialInput = { ...specialFields(form), kind, items: await itemsOf(form, kind) };
    if (id) {
      await updateSpecial(prisma, actor, id, input, ip);
      return "Saved.";
    }
    created = (await createSpecial(prisma, actor, input, ip)).id;
  }, values);
  revalidatePath("/admin/specials", "layout");
  revalidatePath("/", "layout");
  if (result.ok && created) redirect(`/admin/specials/${created}?created=1`);
  return result;
}

export async function endSpecialAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    await endSpecial(prisma, actor, field(form, "id"), ip);
    return "Ended. It no longer shows in the shop.";
  });
  revalidatePath("/admin/specials", "layout");
  revalidatePath("/", "layout");
  return result;
}

const CONSIGNMENT_FIELDS = ["product", "units", "unitCost", "currency"];

export async function consignmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { ...pick(form, [...SPECIAL_FIELDS, ...CONSIGNMENT_FIELDS]), customerTypes: form.getAll("customerTypes").map(String).join(","), featured: on(form, "featured") ? "on" : "", active: "on" };
  let created = "";
  const result = await run(async () => {
    const product = await productByReference(prisma, field(form, "product"), "product");
    const v = pick(form, CONSIGNMENT_FIELDS);
    const special = await launchConsignment(prisma, actor, { productId: product.id, units: v.units, unitCost: v.unitCost, currency: v.currency, special: { ...specialFields(form), active: true } }, ip);
    created = special.id;
  }, values);
  revalidatePath("/admin/specials", "layout");
  revalidatePath("/", "layout");
  if (result.ok && created) redirect(`/admin/specials/${created}?launched=1`);
  return result;
}

// ─── Home page and shop settings ─────────────────────────────────────

export async function shopSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["heroTitle", "heroText", "payDays", "maxLineQuantity"]);
  const result = await run(async () => {
    await updateShopSettings(prisma, actor, { heroTitle: values.heroTitle, heroText: values.heroText, payDays: values.payDays, maxLineQuantity: values.maxLineQuantity }, ip);
    return "Saved.";
  }, values);
  revalidatePath("/", "layout");
  return result;
}

export async function addFeaturedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["reference"]);
  const result = await run(async () => {
    await addFeatured(prisma, actor, values.reference, ip);
    return "Added to the home page.";
  }, values);
  revalidatePath("/", "layout");
  return result;
}

export async function removeFeaturedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeFeatured(prisma, actor, field(form, "productId"), ip));
  revalidatePath("/", "layout");
  return result;
}

export async function moveFeaturedUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await staff();
  const result = await run(() => moveFeaturedUp(prisma, actor, field(form, "productId")));
  revalidatePath("/", "layout");
  return result;
}

// ─── Selling in a market ─────────────────────────────────────────────

export async function marketTaxAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const code = field(form, "code");
  const values = pick(form, ["taxName", "taxPercent", "bankDetails"]);
  const result = await run(async () => {
    await updateMarketTaxAndBank(prisma, actor, code, { taxName: values.taxName, taxPercent: values.taxPercent, bankDetails: values.bankDetails }, ip);
    return "Saved. Shop prices use the new rate now.";
  }, values);
  revalidatePath("/", "layout");
  return result;
}

export async function marketDeliveryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const code = field(form, "code");
  const values = pick(form, ["deliveryFee", "freeDeliveryFrom", "deliveryNote"]);
  const result = await run(async () => {
    await updateMarketDelivery(prisma, actor, code, { deliveryEnabled: on(form, "deliveryEnabled"), deliveryFee: values.deliveryFee, freeDeliveryFrom: values.freeDeliveryFrom, deliveryNote: values.deliveryNote }, ip);
    return "Saved.";
  }, values);
  revalidatePath("/", "layout");
  return result;
}

export async function addCollectionPointAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const code = field(form, "code");
  const values = pick(form, ["name", "address", "hours"]);
  const result = await run(async () => {
    await addCollectionPoint(prisma, actor, code, { name: values.name, address: values.address, hours: values.hours }, ip);
    return "Added.";
  }, values);
  revalidatePath(`/admin/markets/${code}`);
  return result;
}

export async function collectionPointActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => setCollectionPointActive(prisma, actor, field(form, "id"), field(form, "active") === "1", ip));
  revalidatePath(`/admin/markets/${field(form, "code")}`);
  return result;
}

// ─── Orders ──────────────────────────────────────────────────────────

export async function recordPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = pick(form, ["amount", "reference", "receivedOn"]);
  const result = await run(async () => {
    await recordPayment(prisma, actor, { key: appKey() }, id, { amount: values.amount, reference: values.reference, receivedOn: values.receivedOn }, ip);
    await runSoon("email-deliver").catch(() => undefined);
    return "Recorded.";
  }, values);
  revalidatePath("/admin/orders", "layout");
  return result;
}

export async function fulfilOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const result = await run(async () => {
    await fulfilOrder(prisma, actor, { key: appKey() }, id, field(form, "note"), ip);
    await runSoon("email-deliver").catch(() => undefined);
    return "Done. The customer has been told.";
  });
  revalidatePath("/admin/orders", "layout");
  return result;
}

export async function cancelOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = pick(form, ["reason"]);
  const result = await run(async () => {
    if (!id) throw new DomainError("invalid", "No such order.");
    await cancelOrder(prisma, actor, { key: appKey() }, id, values.reason, ip);
    await runSoon("email-deliver").catch(() => undefined);
    return "Cancelled. The customer has been told.";
  }, values);
  revalidatePath("/admin/orders", "layout");
  revalidatePath("/admin/specials", "layout");
  return result;
}
