"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { cancelDelivery, dispatchDelivery, markDelivered, prepareDelivery } from "@/server/logistics/deliveries";
import { deleteDutyRule, saveDutyRule, updateLogisticsRules } from "@/server/logistics/rules";
import { addPurchaseOrders, deleteOverride, deleteShipment, importShipments, recordShipment, removePurchaseOrder, saveOverride, setShipmentStatus, updateShipment, type ShipmentInput } from "@/server/logistics/shipments";
import { countStock, saveWarehouse } from "@/server/logistics/stock";
import { setLineTracking } from "@/server/logistics/tracking";
import { setPoDropShip } from "@/server/procurement/purchase-orders";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/**
 * Admin actions for logistics: shipments and their import, freight
 * figures, duty, the rules, warehouses and stock, deliveries and
 * tracking. Each checks the session again; the service checks the role
 * and writes the audit row.
 */

const values = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
const on = (form: FormData, key: string) => form.get(key) === "on";
const deliver = () => runSoon("email-deliver").catch(() => undefined);
const fresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/admin", "layout");
};

const shipmentInput = (form: FormData): ShipmentInput => ({
  mode: field(form, "mode"),
  originCountry: field(form, "originCountry"),
  destinationCountry: field(form, "destinationCountry"),
  carrier: field(form, "carrier"),
  reference: field(form, "reference"),
  weightKg: field(form, "weightKg"),
  volumeM3: field(form, "volumeM3"),
  currency: field(form, "currency"),
  goodsValue: field(form, "goodsValue"),
  freight: field(form, "freight"),
  insurance: field(form, "insurance"),
  duties: field(form, "duties"),
  clearing: field(form, "clearing"),
  other: field(form, "other"),
  shippedOn: field(form, "shippedOn"),
  arrivedOn: field(form, "arrivedOn"),
  transitDays: field(form, "transitDays"),
  notes: field(form, "notes"),
});

// ─── Shipments ───────────────────────────────────────────────────────

export async function recordShipmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const source = field(form, "source") === "LIVE" ? "LIVE" : "HISTORY";
  let id = "";
  const result = await run(async () => {
    id = (await recordShipment(prisma, actor, source, shipmentInput(form), ip)).id;
  }, values(form));
  if (!result.ok) return result;
  fresh("/admin/logistics", "/admin/logistics/estimates");
  redirect(`/admin/logistics/shipments/${id}`);
}

export async function updateShipmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "shipmentId");
  const result = await run(() => updateShipment(prisma, actor, id, shipmentInput(form), ip).then(() => "Saved."), values(form));
  fresh(`/admin/logistics/shipments/${id}`, "/admin/logistics", "/admin/logistics/estimates");
  return result;
}

export async function deleteShipmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => deleteShipment(prisma, actor, field(form, "shipmentId"), ip));
  if (!result.ok) return result;
  fresh("/admin/logistics", "/admin/logistics/estimates");
  redirect("/admin/logistics");
}

export async function shipmentStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "shipmentId");
  const result = await run(() => setShipmentStatus(prisma, actor, id, field(form, "status"), ip).then(() => "Updated. Its order lines moved along with it."));
  fresh(`/admin/logistics/shipments/${id}`, "/admin/logistics", "/admin/purchase-orders");
  return result;
}

export async function addShipmentPosAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "shipmentId");
  const result = await run(() => addPurchaseOrders(prisma, actor, id, field(form, "numbers"), ip).then(() => "Added."), values(form));
  fresh(`/admin/logistics/shipments/${id}`);
  return result;
}

export async function removeShipmentPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "shipmentId");
  const result = await run(() => removePurchaseOrder(prisma, actor, id, field(form, "poId"), ip).then(() => "Taken off."));
  fresh(`/admin/logistics/shipments/${id}`);
  return result;
}

export async function importShipmentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    const f = form.get("file");
    if (f instanceof File && f.size > 5 * 1024 * 1024) throw new DomainError("invalid", "The file is larger than 5 MB. Split it into smaller files.", "file");
    const n = await importShipments(prisma, actor, f instanceof File ? await f.text() : "", ip);
    return `Loaded ${n} past ${n === 1 ? "shipment" : "shipments"}. The estimates now use them.`;
  });
  fresh("/admin/logistics", "/admin/logistics/estimates");
  return result;
}

// ─── Estimates and duty ──────────────────────────────────────────────

export async function saveOverrideAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const v = { originCountry: field(form, "originCountry"), mode: field(form, "mode"), perKg: field(form, "perKg"), feesPerKg: field(form, "feesPerKg"), transitDays: field(form, "transitDays"), note: field(form, "note") };
  const result = await run(() => saveOverride(prisma, actor, v, ip).then(() => "Saved. Costs were worked out again."), v);
  fresh("/admin/logistics/estimates");
  return result;
}

export async function deleteOverrideAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => deleteOverride(prisma, actor, field(form, "overrideId"), ip).then(() => "Back to the history."));
  fresh("/admin/logistics/estimates");
  return result;
}

export async function saveDutyRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "ruleId") || null;
  const v = { categoryId: field(form, "categoryId"), destinationCountry: field(form, "destinationCountry"), dutyPercent: field(form, "dutyPercent"), leviesPercent: field(form, "leviesPercent"), exemptOrigins: field(form, "exemptOrigins"), note: field(form, "note") };
  const result = await run(() => saveDutyRule(prisma, actor, id, v, ip).then(() => "Saved. Costs were worked out again."), v);
  fresh("/admin/logistics/duty");
  return result;
}

export async function deleteDutyRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => deleteDutyRule(prisma, actor, field(form, "ruleId"), ip).then(() => "Removed."));
  fresh("/admin/logistics/duty");
  return result;
}

export async function logisticsRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const v = values(form);
  const input = { homeCountry: field(form, "homeCountry"), airKgPerM3: field(form, "airKgPerM3"), courierKgPerM3: field(form, "courierKgPerM3"), roadKgPerM3: field(form, "roadKgPerM3"), seaKgPerM3: field(form, "seaKgPerM3"), insurancePercent: field(form, "insurancePercent"), sampleSize: field(form, "sampleSize"), incoterm: field(form, "incoterm"), useStock: on(form, "useStock"), dropShipByDefault: on(form, "dropShipByDefault") };
  const result = await run(() => updateLogisticsRules(prisma, actor, input, ip).then(() => "Saved. Costs were worked out again."), v);
  fresh("/admin/logistics/rules");
  return result;
}

// ─── Stock ───────────────────────────────────────────────────────────

export async function saveWarehouseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "warehouseId") || null;
  const result = await run(() => saveWarehouse(prisma, actor, id, { code: field(form, "code"), name: field(form, "name"), country: field(form, "country"), address: field(form, "address"), active: on(form, "active"), isDefault: on(form, "isDefault") }, ip).then(() => "Saved."), values(form));
  fresh("/admin/stock");
  return result;
}

export async function countStockAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => countStock(prisma, actor, field(form, "warehouseId"), field(form, "productId"), field(form, "count"), field(form, "note"), ip).then(() => "Saved."), values(form));
  fresh("/admin/stock");
  return result;
}

// ─── Orders: drop-ship, tracking and deliveries ──────────────────────

export async function dropShipAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const dropShip = field(form, "dropShip") === "yes";
  const result = await run(() => setPoDropShip(prisma, actor, id, dropShip, ip).then(() => (dropShip ? "The supplier will deliver to the customer." : "The supplier will deliver to our warehouse.")));
  fresh(`/admin/purchase-orders/${id}`);
  return result;
}

export async function lineTrackingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => setLineTracking(prisma, actor, field(form, "lineId"), field(form, "status"), field(form, "note"), ip).then(() => "Updated."));
  fresh(`/admin/orders/${field(form, "orderId")}`);
  return result;
}

export async function prepareDeliveryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const orderId = field(form, "orderId");
  const quantities = Object.fromEntries([...form.entries()].filter(([k, v]) => k.startsWith("qty-") && typeof v === "string").map(([k, v]) => [k.slice(4), String(v)]));
  const result = await run(() => prepareDelivery(prisma, actor, orderId, { quantities, carrier: field(form, "carrier"), reference: field(form, "reference") }, ip).then((d) => `Delivery ${d.number} is ready to pack. Print its note.`), values(form));
  fresh(`/admin/orders/${orderId}`, "/admin/deliveries");
  return result;
}

export async function cancelDeliveryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => cancelDelivery(prisma, actor, field(form, "deliveryId"), ip).then(() => "Unpacked."));
  fresh(`/admin/orders/${field(form, "orderId")}`, "/admin/deliveries");
  return result;
}

export async function dispatchDeliveryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => dispatchDelivery(prisma, actor, { key: appKey() }, field(form, "deliveryId"), { carrier: field(form, "carrier"), reference: field(form, "reference") }, ip).then(() => "Dispatched."));
  if (result.ok) await deliver();
  fresh(`/admin/orders/${field(form, "orderId")}`, "/admin/deliveries", "/admin/orders");
  return result;
}

export async function deliveredAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    const f = form.get("pod");
    const file = f instanceof File && f.size ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    await markDelivered(prisma, actor, { key: appKey() }, field(form, "deliveryId"), field(form, "receivedBy"), file, ip);
    return "Saved as delivered.";
  });
  fresh(`/admin/orders/${field(form, "orderId")}`, "/admin/deliveries");
  return result;
}
