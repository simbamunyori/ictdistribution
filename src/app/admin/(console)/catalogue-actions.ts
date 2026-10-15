"use server";

import type { ImportSchedule, ProductStatus, SourcingRule, SpecKind, SupplierEventKind, SupplierKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PRICE_LIST_FIELD_KEYS, type ColumnMap } from "@/lib/price-list";
import { field, run, type ActionState } from "@/server/action-state";
import { addSpecField, createCategory, deleteCategory, removeSpecField, setSuggestions, updateCategory, updateSpecField, type CategoryInput, type SpecFieldInput } from "@/server/catalogue/categories";
import { addDatasheet, addImage, moveImageUp, removeMedia, setImageText } from "@/server/catalogue/media";
import { createProduct, linkProducts, saveSpecs, unlinkProducts, updateProduct, type ProductInput } from "@/server/catalogue/products";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { applyImport, discardImport, saveColumns, saveSchedule, startImport } from "@/server/suppliers/price-lists";
import { setDefaultRule } from "@/server/suppliers/sourcing";
import { addContact, createSupplier, recordEvent, removeContact, removeOffer, removeSupplier, saveOffer, setSupplierCategories, updateSupplier, type SupplierInput } from "@/server/suppliers/suppliers";
import { staff } from "./staff-actor";

/**
 * Admin actions for the catalogue and suppliers. Each checks the session
 * again; the service checks the role and writes the audit row.
 */

const on = (form: FormData, key: string) => form.get(key) === "on";
const pick = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(form, k)]));
const rule = (v: string) => (v ? (v as SourcingRule) : null);

async function upload(form: FormData, key = "file") {
  const f = form.get(key);
  if (!(f instanceof File) || !f.size) throw new DomainError("invalid", "Choose a file.", key);
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

// ─── Categories ──────────────────────────────────────────────────────

const CATEGORY_FIELDS = ["name", "slug", "description", "parentId", "sortOrder", "sourcingRule", "hsCode"];

function categoryInput(form: FormData): CategoryInput {
  const v = pick(form, CATEGORY_FIELDS);
  return { name: v.name, slug: v.slug, description: v.description, parentId: v.parentId || null, sortOrder: v.sortOrder.trim() === "" ? 0 : Number(v.sortOrder), active: on(form, "active"), sourcingRule: rule(v.sourcingRule), hsCode: v.hsCode };
}

export async function categoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = pick(form, CATEGORY_FIELDS);
  let created = "";
  const result = await run(async () => {
    if (id) {
      await updateCategory(prisma, actor, id, categoryInput(form), ip);
      return "Saved.";
    }
    created = (await createCategory(prisma, actor, categoryInput(form), ip)).id;
  }, values);
  revalidatePath("/admin/categories", "layout");
  if (result.ok && created) redirect(`/admin/categories/${created}?created=1`);
  return result;
}

export async function deleteCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => deleteCategory(prisma, actor, field(form, "id"), ip));
  if (result.ok) redirect("/admin/categories");
  return result;
}

export async function suggestionsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const result = await run(async () => {
    await setSuggestions(prisma, actor, id, form.getAll("related").map(String), ip);
    return "Saved.";
  });
  revalidatePath(`/admin/categories/${id}`);
  return result;
}

const SPEC_FIELDS = ["label", "key", "kind", "unit", "options", "sortOrder"];

function specInput(form: FormData): SpecFieldInput {
  const v = pick(form, SPEC_FIELDS);
  return { label: v.label, key: v.key, kind: v.kind as SpecKind, unit: v.unit, options: v.options, filterable: on(form, "filterable"), highlight: on(form, "highlight"), mustMatch: on(form, "mustMatch"), sortOrder: v.sortOrder.trim() === "" ? 0 : Number(v.sortOrder) };
}

export async function specFieldAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const categoryId = field(form, "categoryId");
  const values = pick(form, SPEC_FIELDS);
  const result = await run(async () => {
    if (id) {
      await updateSpecField(prisma, actor, id, specInput(form), ip);
      return "Saved.";
    }
    await addSpecField(prisma, actor, categoryId, specInput(form), ip);
    return "Added.";
  }, values);
  revalidatePath(`/admin/categories/${categoryId}`);
  return result.ok && !id ? { ...result, values: undefined } : result;
}

export async function removeSpecFieldAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeSpecField(prisma, actor, field(form, "id"), ip));
  revalidatePath(`/admin/categories/${field(form, "categoryId")}`);
  return result;
}

// ─── Products ────────────────────────────────────────────────────────

const PRODUCT_FIELDS = ["name", "brand", "mpn", "categoryId", "slug", "summary", "description", "warrantyMonths", "warrantyTerms", "status", "sourcingRule", "weightKg", "lengthCm", "widthCm", "heightCm"];

function productInput(form: FormData): ProductInput {
  const v = pick(form, PRODUCT_FIELDS);
  return { ...v, status: (v.status || "DRAFT") as ProductStatus, sourcingRule: rule(v.sourcingRule), sellToIndividuals: on(form, "sellToIndividuals") } as ProductInput;
}

export async function productAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = pick(form, PRODUCT_FIELDS);
  let created = "";
  const result = await run(async () => {
    if (id) {
      await updateProduct(prisma, actor, id, productInput(form), ip);
      return "Saved.";
    }
    created = (await createProduct(prisma, actor, productInput(form), ip)).id;
  }, values);
  revalidatePath("/admin/products", "layout");
  if (result.ok && created) redirect(`/admin/products/${created}?created=1`);
  return result;
}

export async function specsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("spec.") && typeof v === "string") raw[k.slice(5)] = v;
  // Unticked yes-or-no boxes send nothing; the form lists them so they can be cleared.
  for (const k of form.getAll("yesNo").map(String)) raw[k] = raw[k] === "yes" ? "yes" : raw[k] === "no" ? "no" : "";
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [`spec.${k}`, v]));
  const result = await run(async () => {
    await saveSpecs(prisma, actor, id, raw, ip);
    return "Saved.";
  }, values);
  revalidatePath(`/admin/products/${id}`);
  return result;
}

export async function imageAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "productId");
  const result = await run(async () => {
    await addImage(prisma, actor, id, await upload(form), field(form, "alt"), ip);
    return "Added.";
  });
  revalidatePath(`/admin/products/${id}`);
  return result;
}

export async function datasheetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "productId");
  const result = await run(async () => {
    await addDatasheet(prisma, actor, id, await upload(form), field(form, "title"), ip);
    return "Added.";
  });
  revalidatePath(`/admin/products/${id}`);
  return result;
}

export async function mediaAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const op = field(form, "op");
  const result = await run(async () => {
    if (op === "remove") await removeMedia(prisma, actor, id, ip);
    else if (op === "up") await moveImageUp(prisma, actor, id, ip);
    else if (op === "text") {
      await setImageText(prisma, actor, id, field(form, "alt"), ip);
      return "Saved.";
    }
  });
  revalidatePath(`/admin/products/${field(form, "productId")}`);
  return result;
}

export async function linkAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "productId");
  const values = pick(form, ["reference"]);
  const result = await run(async () => {
    if (field(form, "op") === "unlink") await unlinkProducts(prisma, actor, id, field(form, "otherId"), ip);
    else await linkProducts(prisma, actor, id, values.reference, ip);
  }, values);
  revalidatePath(`/admin/products/${id}`);
  return result.ok ? { ...result, values: undefined } : result;
}

// ─── Suppliers ───────────────────────────────────────────────────────

const SUPPLIER_FIELDS = ["name", "kind", "country", "currency", "email", "whatsapp", "phone", "website", "portalUrl", "notes", "leadTimeDays", "minOrder", "landedCostPercent", "freightMode"];

function supplierInput(form: FormData): SupplierInput {
  const v = pick(form, SUPPLIER_FIELDS);
  return { ...v, kind: v.kind as SupplierKind, preferred: on(form, "preferred"), active: on(form, "active") } as SupplierInput;
}

export async function supplierAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const values = pick(form, SUPPLIER_FIELDS);
  let created = "";
  const result = await run(async () => {
    if (id) {
      await updateSupplier(prisma, actor, id, supplierInput(form), ip);
      return "Saved.";
    }
    created = (await createSupplier(prisma, actor, supplierInput(form), ip)).id;
  }, values);
  revalidatePath("/admin/suppliers", "layout");
  if (result.ok && created) redirect(`/admin/suppliers/${created}?created=1`);
  return result;
}

export async function removeSupplierAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeSupplier(prisma, actor, field(form, "id"), ip));
  revalidatePath("/admin/suppliers", "layout");
  if (result.ok) redirect("/admin/suppliers");
  return result;
}

export async function supplierCategoriesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "id");
  const result = await run(async () => {
    await setSupplierCategories(prisma, actor, id, form.getAll("categoryId").map(String), ip);
    return "Saved.";
  });
  revalidatePath(`/admin/suppliers/${id}`);
  return result;
}

export async function contactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const values = pick(form, ["name", "role", "email", "phone", "whatsapp"]);
  const result = await run(async () => {
    if (field(form, "op") === "remove") await removeContact(prisma, actor, field(form, "id"), ip);
    else {
      await addContact(prisma, actor, supplierId, { name: values.name, role: values.role, email: values.email, phone: values.phone, whatsapp: values.whatsapp }, ip);
      return "Added.";
    }
  }, values);
  revalidatePath(`/admin/suppliers/${supplierId}`);
  return result.ok ? { ...result, values: undefined } : result;
}

export async function supplierEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const values = pick(form, ["kind", "occurredOn", "note", "reference"]);
  const result = await run(async () => {
    await recordEvent(prisma, actor, supplierId, { kind: values.kind as SupplierEventKind, occurredOn: values.occurredOn, note: values.note, reference: values.reference }, ip);
    return "Recorded.";
  }, values);
  revalidatePath(`/admin/suppliers/${supplierId}`);
  return result.ok ? { ...result, values: undefined } : result;
}

const OFFER_FIELDS = ["supplierId", "cost", "supplierSku", "leadTimeDays", "moq", "stock"];

export async function offerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const productId = field(form, "productId");
  const values = pick(form, OFFER_FIELDS);
  const result = await run(async () => {
    if (field(form, "op") === "remove") await removeOffer(prisma, actor, field(form, "id"), ip);
    else {
      await saveOffer(prisma, actor, { supplierId: values.supplierId, productId, cost: values.cost, supplierSku: values.supplierSku, leadTimeDays: values.leadTimeDays, moq: values.moq, stock: values.stock, active: field(form, "active") !== "off" }, ip);
      return "Saved.";
    }
  }, values);
  revalidatePath(`/admin/products/${productId}`);
  return result.ok && !field(form, "id") ? { ...result, values: undefined } : result;
}

export async function defaultRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    await setDefaultRule(prisma, actor, field(form, "rule") as SourcingRule, ip);
    return "Saved. Supplier choices use it straight away.";
  });
  revalidatePath("/admin/sourcing");
  return result;
}

// ─── Price lists ─────────────────────────────────────────────────────

export async function uploadPriceListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  let importId = "";
  const result = await run(async () => {
    importId = (await startImport(prisma, actor, supplierId, await upload(form), "upload", ip)).id;
  });
  revalidatePath(`/admin/suppliers/${supplierId}`);
  if (result.ok && importId) redirect(`/admin/suppliers/${supplierId}/imports/${importId}`);
  return result;
}

export async function columnsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const importId = field(form, "importId");
  const columns: ColumnMap = Object.fromEntries(PRICE_LIST_FIELD_KEYS.map((f) => [f, field(form, `col.${f}`)]).filter(([, v]) => v));
  const values = { ...pick(form, ["sheet", "headerRow", "currency"]), ...Object.fromEntries(PRICE_LIST_FIELD_KEYS.map((f) => [`col.${f}`, field(form, `col.${f}`)])) };
  const result = await run(() => saveColumns(prisma, actor, importId, { columns, sheet: field(form, "sheet") || null, headerRow: Number(field(form, "headerRow") || "1"), currency: field(form, "currency") || null }, ip), values);
  revalidatePath(`/admin/suppliers/${supplierId}`, "layout");
  if (result.ok) redirect(`/admin/suppliers/${supplierId}/imports/${importId}`);
  return result;
}

export async function applyPriceListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const importId = field(form, "importId");
  const result = await run(async () => {
    const c = await applyImport(prisma, actor, importId, { deactivateMissing: on(form, "deactivateMissing"), draftsCategoryId: field(form, "draftsCategoryId") || null }, ip);
    return `Applied: ${c.updated} offers updated, ${c.added} added${c.drafts ? `, ${c.drafts} draft products made` : ""}${c.switchedOff ? `, ${c.switchedOff} switched off` : ""}.`;
  });
  revalidatePath(`/admin/suppliers/${supplierId}`, "layout");
  revalidatePath("/admin", "layout");
  return result;
}

export async function discardPriceListAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const result = await run(() => discardImport(prisma, actor, field(form, "importId"), ip));
  revalidatePath(`/admin/suppliers/${supplierId}`, "layout");
  revalidatePath("/admin", "layout");
  if (result.ok) redirect(`/admin/suppliers/${supplierId}`);
  return result;
}

export async function scheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const supplierId = field(form, "supplierId");
  const values = pick(form, ["sourceUrl", "schedule", "autoApplyPercent"]);
  const result = await run(async () => {
    await saveSchedule(prisma, actor, supplierId, { sourceUrl: values.sourceUrl, schedule: (values.schedule || "OFF") as ImportSchedule, autoApplyPercent: values.autoApplyPercent, deactivateMissing: on(form, "deactivateMissing") }, ip);
    return "Saved.";
  }, values);
  revalidatePath(`/admin/suppliers/${supplierId}`);
  return result;
}
