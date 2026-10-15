import type { Category, Prisma, PrismaClient, SourcingRule, SpecField, SpecKind } from "@prisma/client";
import { SPEC_KEY, slugify, specKey } from "@/lib/catalogue";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { refreshCosts } from "@/server/shop/costs";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Categories and subcategories (one level down), and the specifications
 * products in each carry. A subcategory inherits its parent's
 * specifications and adds its own. All of it is edited at
 * /admin/categories.
 */

export const SPEC_KIND_LABEL: Record<SpecKind, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  YES_NO: "Yes or no",
  CHOICE: "One of a list",
};

export type CategoryWithFields = Category & { specFields: SpecField[]; parent: (Category & { specFields: SpecField[] }) | null };

/** Top-level categories with their subcategories, in order, with product counts. */
export async function categoryTree(db: Pick<PrismaClient, "category">) {
  return db.category.findMany({
    where: { parentId: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { products: true } },
      children: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } },
    },
  });
}

/** Every category as "Parent / Child" options, for choosing where a product goes. */
export async function categoryOptions(db: Pick<PrismaClient, "category">) {
  const tree = await categoryTree(db);
  return tree.flatMap((c) => [{ value: c.id, label: c.name }, ...c.children.map((s) => ({ value: s.id, label: `${c.name} / ${s.name}` }))]);
}

export async function getCategory(db: Pick<PrismaClient, "category">, id: string): Promise<CategoryWithFields> {
  const c = await db.category.findUnique({ where: { id }, include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }, parent: { include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } } } });
  if (!c) throw new DomainError("not-found", "No such category.");
  return c;
}

/** A category's specifications: its parent's first, then its own. */
export function specFieldsOf(c: { specFields: SpecField[]; parent?: { specFields: SpecField[] } | null }): SpecField[] {
  return [...(c.parent?.specFields ?? []), ...c.specFields];
}

// ─── Editing categories ──────────────────────────────────────────────

export interface CategoryInput {
  name: string;
  slug?: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  sourcingRule: SourcingRule | null;
}

const RULES: SourcingRule[] = ["CHEAPEST_LANDED", "FASTEST", "PREFERRED"];

function checkCategory(input: CategoryInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const slug = slugify(input.slug?.trim() || name);
  const description = input.description.trim();
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Enter a name of 2 to 60 characters.";
  if (!slug) fieldErrors.slug = "Use letters or digits.";
  if (description.length > 400) fieldErrors.description = "Keep it under 400 characters.";
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10_000) fieldErrors.sortOrder = "Enter a whole number from 0 to 10,000.";
  if (input.sourcingRule && !RULES.includes(input.sourcingRule)) fieldErrors.sourcingRule = "Choose a rule.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { name, slug, description };
}

async function checkPlacement(tx: Prisma.TransactionClient, id: string | null, parentId: string | null) {
  if (!parentId) return;
  if (parentId === id) throw new DomainError("invalid", "A category can't sit inside itself.", "parentId");
  const parent = await tx.category.findUnique({ where: { id: parentId } });
  if (!parent) throw new DomainError("invalid", "Choose a category to put it in.", "parentId");
  if (parent.parentId) throw new DomainError("invalid", "Subcategories go one level deep. Choose a top-level category.", "parentId");
  if (id && (await tx.category.count({ where: { parentId: id } }))) throw new DomainError("invalid", "This category has subcategories, so it stays at the top level.", "parentId");
}

async function checkSlug(tx: Prisma.TransactionClient, slug: string, id: string | null) {
  const clash = await tx.category.findUnique({ where: { slug } });
  if (clash && clash.id !== id) throw new DomainError("conflict", `"${slug}" is already used by ${clash.name}.`, "slug");
}

export async function createCategory(db: PrismaClient, actor: StaffActor, input: CategoryInput, ip?: string | null): Promise<Category> {
  assertStaffCan(actor, "manageCatalogue");
  const { name, slug, description } = checkCategory(input);
  return db.$transaction(async (tx) => {
    await checkPlacement(tx, null, input.parentId);
    await checkSlug(tx, slug, null);
    const c = await tx.category.create({ data: { name, slug, description, parentId: input.parentId, sortOrder: input.sortOrder, active: input.active, sourcingRule: input.sourcingRule } });
    await audit(tx, staffAudit(actor, { action: "category.created", summary: `Added the category ${name}`, targetType: "Category", targetId: c.id, ipAddress: ip }));
    return c;
  });
}

export async function updateCategory(db: PrismaClient, actor: StaffActor, id: string, input: CategoryInput, ip?: string | null): Promise<Category> {
  assertStaffCan(actor, "manageCatalogue");
  const { name, slug, description } = checkCategory(input);
  const result = await db.$transaction(async (tx) => {
    const before = await tx.category.findUnique({ where: { id } });
    if (!before) throw new DomainError("not-found", "No such category.");
    await checkPlacement(tx, id, input.parentId);
    await checkSlug(tx, slug, id);
    if (input.parentId && input.parentId !== before.parentId) await checkKeysFit(tx, id, input.parentId);
    const after = await tx.category.update({ where: { id }, data: { name, slug, description, parentId: input.parentId, sortOrder: input.sortOrder, active: input.active, sourcingRule: input.sourcingRule } });
    const changes: string[] = [];
    if (before.name !== name) changes.push(`name to ${name}`);
    if (before.slug !== slug) changes.push(`address to /categories/${slug}`);
    if (before.parentId !== input.parentId) changes.push(input.parentId ? "moved under another category" : "moved to the top level");
    if (before.active !== input.active) changes.push(input.active ? "shown in the shop" : "hidden from the shop");
    if (before.sourcingRule !== input.sourcingRule) changes.push(`supplier rule to ${input.sourcingRule ?? "the default"}`);
    if (before.description !== description || before.sortOrder !== input.sortOrder) changes.push("details");
    if (changes.length) await audit(tx, staffAudit(actor, { action: "category.updated", summary: `Changed ${before.name}: ${changes.join(", ")}`, targetType: "Category", targetId: id, ipAddress: ip }));
    return { after, ruleChanged: before.sourcingRule !== input.sourcingRule };
  });
  if (result.ruleChanged) {
    const products = await db.product.findMany({ where: { OR: [{ categoryId: id }, { category: { parentId: id } }] }, select: { id: true } });
    await refreshCosts(db, products.map((p) => p.id));
  }
  return result.after;
}

/** Only an empty category can go: no products and no subcategories. */
export async function deleteCategory(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!c) return;
    if (c._count.products || c._count.children) throw new DomainError("conflict", "Move its products and subcategories out first, or hide it instead.");
    await tx.category.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "category.deleted", summary: `Removed the empty category ${c.name}`, targetType: "Category", targetId: id, ipAddress: ip }));
  });
}

/** Which categories' products we suggest alongside this one's. */
export async function setSuggestions(db: PrismaClient, actor: StaffActor, id: string, relatedIds: string[], ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  const ids = [...new Set(relatedIds)].filter((r) => r !== id).slice(0, 12);
  await db.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id } });
    if (!c) throw new DomainError("not-found", "No such category.");
    const found = await tx.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    await tx.categorySuggestion.deleteMany({ where: { categoryId: id } });
    if (found.length) await tx.categorySuggestion.createMany({ data: found.map((f) => ({ categoryId: id, relatedId: f.id })) });
    await audit(tx, staffAudit(actor, { action: "category.suggestions", summary: found.length ? `${c.name} now suggests ${found.map((f) => f.name).join(", ")}` : `${c.name} no longer suggests other categories`, targetType: "Category", targetId: id, ipAddress: ip }));
  });
}

// ─── Specifications ──────────────────────────────────────────────────

export interface SpecFieldInput {
  label: string;
  /** Only when adding: fixed after that, because product values are kept under it. */
  key?: string;
  kind: SpecKind;
  unit: string;
  /** For CHOICE: one option per line. */
  options: string;
  filterable: boolean;
  highlight: boolean;
  mustMatch: boolean;
  sortOrder: number;
}

const KINDS: SpecKind[] = ["TEXT", "NUMBER", "YES_NO", "CHOICE"];

function checkField(input: SpecFieldInput) {
  const label = input.label.trim().replace(/\s+/g, " ");
  const unit = input.unit.trim();
  const options = [...new Set(input.options.split(/\r?\n|,/).map((o) => o.trim()).filter(Boolean))];
  const fieldErrors: Record<string, string> = {};
  if (label.length < 1 || label.length > 40) fieldErrors.label = "Enter a name of up to 40 characters.";
  if (!KINDS.includes(input.kind)) fieldErrors.kind = "Choose a kind.";
  if (unit.length > 12) fieldErrors.unit = "Keep the unit short, like GB or W.";
  if (input.kind === "CHOICE" && options.length < 2) fieldErrors.options = "Give at least two options, one per line.";
  if (options.length > 60 || options.some((o) => o.length > 60)) fieldErrors.options = "Up to 60 options of up to 60 characters each.";
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10_000) fieldErrors.sortOrder = "Enter a whole number from 0 to 10,000.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { label, unit: input.kind === "NUMBER" ? unit : "", options: input.kind === "CHOICE" ? options : [] };
}

/** A key must be unique across a category, its parent and its subcategories, since products see them together. */
async function keyTaken(tx: Prisma.TransactionClient, categoryId: string, key: string, exceptId?: string) {
  const c = await tx.category.findUniqueOrThrow({ where: { id: categoryId }, select: { parentId: true } });
  const family = [categoryId, ...(c.parentId ? [c.parentId] : []), ...(await tx.category.findMany({ where: { parentId: categoryId }, select: { id: true } })).map((x) => x.id)];
  return Boolean(await tx.specField.findFirst({ where: { categoryId: { in: family }, key, ...(exceptId ? { id: { not: exceptId } } : {}) } }));
}

/** Moving a subcategory under a new parent: their keys mustn't clash. */
async function checkKeysFit(tx: Prisma.TransactionClient, id: string, parentId: string) {
  const [mine, theirs] = await Promise.all([tx.specField.findMany({ where: { categoryId: id }, select: { key: true } }), tx.specField.findMany({ where: { categoryId: parentId }, select: { key: true } })]);
  const clash = mine.find((m) => theirs.some((t) => t.key === m.key));
  if (clash) throw new DomainError("conflict", `Both categories have a specification called ${clash.key}. Remove one first.`, "parentId");
}

export async function addSpecField(db: PrismaClient, actor: StaffActor, categoryId: string, input: SpecFieldInput, ip?: string | null): Promise<SpecField> {
  assertStaffCan(actor, "manageCatalogue");
  const v = checkField(input);
  const key = input.key?.trim() || specKey(v.label);
  if (!SPEC_KEY.test(key)) throw new DomainError("invalid", "Use lower case letters, digits and underscores, starting with a letter.", "key");
  return db.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id: categoryId } });
    if (!c) throw new DomainError("not-found", "No such category.");
    if (await keyTaken(tx, categoryId, key)) throw new DomainError("conflict", `This category or one related to it already has ${key}. Choose another name.`, "key");
    const f = await tx.specField.create({ data: { categoryId, key, kind: input.kind, ...v, filterable: input.filterable, highlight: input.highlight, mustMatch: input.mustMatch, sortOrder: input.sortOrder } });
    await audit(tx, staffAudit(actor, { action: "spec-field.added", summary: `Added the specification ${v.label} to ${c.name}`, targetType: "Category", targetId: categoryId, ipAddress: ip }));
    return f;
  });
}

/** The key and kind stay as they are; everything else can change. */
export async function updateSpecField(db: PrismaClient, actor: StaffActor, id: string, input: Omit<SpecFieldInput, "key" | "kind">, ip?: string | null): Promise<SpecField> {
  assertStaffCan(actor, "manageCatalogue");
  return db.$transaction(async (tx) => {
    const before = await tx.specField.findUnique({ where: { id }, include: { category: true } });
    if (!before) throw new DomainError("not-found", "No such specification.");
    const v = checkField({ ...input, kind: before.kind });
    const f = await tx.specField.update({ where: { id }, data: { ...v, filterable: input.filterable, highlight: input.highlight, mustMatch: input.mustMatch, sortOrder: input.sortOrder } });
    await audit(tx, staffAudit(actor, { action: "spec-field.updated", summary: `Changed the specification ${before.label} in ${before.category.name}`, targetType: "Category", targetId: before.categoryId, ipAddress: ip }));
    return f;
  });
}

/** Products keep their values, unused, so adding the field back restores them. */
export async function removeSpecField(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const f = await tx.specField.findUnique({ where: { id }, include: { category: true } });
    if (!f) return;
    await tx.specField.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "spec-field.removed", summary: `Removed the specification ${f.label} from ${f.category.name}`, targetType: "Category", targetId: f.categoryId, ipAddress: ip }));
  });
}
