import type { Prisma, PrismaClient, Product, ProductStatus, SourcingRule } from "@prisma/client";
import { mpnKey, parseSpecValue, searchTextFor, slugify, type SpecValues } from "@/lib/catalogue";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { specFieldsOf } from "./categories";

/**
 * Products: what we sell, under our brand. Supplier details never live
 * here; they are offers (src/server/suppliers). Edited at /admin/products.
 */

export const STATUS_LABEL: Record<ProductStatus, string> = { DRAFT: "Draft", ACTIVE: "In the shop", ARCHIVED: "Archived" };
const STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];
const RULES: SourcingRule[] = ["CHEAPEST_LANDED", "FASTEST", "PREFERRED"];
export const PAGE_SIZE = 50;

type Tx = Prisma.TransactionClient;

export interface ProductListFilter {
  q?: string;
  categoryId?: string;
  status?: ProductStatus;
  page?: number;
}

export async function listProducts(db: Pick<PrismaClient, "product">, f: ProductListFilter = {}) {
  const terms = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const where: Prisma.ProductWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.categoryId ? { OR: [{ categoryId: f.categoryId }, { category: { parentId: f.categoryId } }] } : {}),
    ...(terms.length ? { AND: terms.map((t) => ({ OR: [{ searchText: { contains: t } }, { mpnKey: { contains: mpnKey(t) } }] })) } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, mpn: true, status: true, updatedAt: true, brand: { select: { name: true } }, category: { select: { name: true } }, _count: { select: { offers: { where: { active: true } }, media: true } } },
    }),
    db.product.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Everything the product page in the admin area shows, except supplier offers (see suppliers/sourcing). */
export async function getProduct(db: Pick<PrismaClient, "product">, id: string) {
  const p = await db.product.findUnique({
    where: { id },
    include: {
      brand: true,
      category: { include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }, parent: { include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } } } },
      media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, filename: true, contentType: true, size: true, width: true, height: true, alt: true, sortOrder: true } },
      links: { include: { related: { select: { id: true, name: true, mpn: true, status: true } } } },
      linkedBy: { include: { product: { select: { id: true, name: true, mpn: true, status: true } } } },
    },
  });
  if (!p) throw new DomainError("not-found", "No such product.");
  return { ...p, related: [...p.links.map((l) => l.related), ...p.linkedBy.map((l) => l.product)].sort((a, b) => a.name.localeCompare(b.name)) };
}

// ─── Brands ──────────────────────────────────────────────────────────

export async function brandNames(db: Pick<PrismaClient, "brand">) {
  return (await db.brand.findMany({ orderBy: { name: "asc" }, select: { name: true } })).map((b) => b.name);
}

/** Finds a brand by name, ignoring case, or adds it. */
export async function brandFor(tx: Tx, nameInput: string) {
  const name = nameInput.trim().replace(/\s+/g, " ");
  const found = await tx.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (found) return found;
  let slug = slugify(name) || "brand";
  if (await tx.brand.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  return tx.brand.create({ data: { name, slug } });
}

// ─── Editing ─────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  brand: string;
  mpn: string;
  categoryId: string;
  slug?: string;
  summary: string;
  description: string;
  /** Empty for none. */
  warrantyMonths: string;
  warrantyTerms: string;
  sellToIndividuals: boolean;
  status: ProductStatus;
  sourcingRule: SourcingRule | null;
}

function checkProduct(input: ProductInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const brand = input.brand.trim().replace(/\s+/g, " ");
  const mpn = input.mpn.trim();
  const summary = input.summary.trim();
  const description = input.description.trim();
  const warrantyTerms = input.warrantyTerms.trim();
  const fieldErrors: Record<string, string> = {};
  if (name.length < 3 || name.length > 160) fieldErrors.name = "Enter a name of 3 to 160 characters.";
  if (brand.length < 1 || brand.length > 60) fieldErrors.brand = "Enter the brand.";
  if (!mpnKey(mpn) || mpn.length > 80) fieldErrors.mpn = "Enter the manufacturer part number.";
  if (!input.categoryId) fieldErrors.categoryId = "Choose a category.";
  if (summary.length > 300) fieldErrors.summary = "Keep it under 300 characters.";
  if (description.length > 10_000) fieldErrors.description = "Keep it under 10,000 characters.";
  if (warrantyTerms.length > 120) fieldErrors.warrantyTerms = "Keep it under 120 characters.";
  let warrantyMonths: number | null = null;
  if (input.warrantyMonths.trim()) {
    warrantyMonths = Number(input.warrantyMonths);
    if (!Number.isInteger(warrantyMonths) || warrantyMonths < 0 || warrantyMonths > 120) fieldErrors.warrantyMonths = "Enter whole months, 0 to 120.";
  }
  if (!STATUSES.includes(input.status)) fieldErrors.status = "Choose a status.";
  if (input.sourcingRule && !RULES.includes(input.sourcingRule)) fieldErrors.sourcingRule = "Choose a rule.";
  const slug = slugify(input.slug?.trim() || `${brand} ${name}`);
  if (input.slug?.trim() && !slug) fieldErrors.slug = "Use letters or digits.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { name, brand, mpn, summary, description, warrantyTerms, warrantyMonths, slug };
}

async function uniqueSlug(tx: Tx, wanted: string, id: string | null, explicit: boolean) {
  const clash = await tx.product.findUnique({ where: { slug: wanted } });
  if (!clash || clash.id === id) return wanted;
  if (explicit) throw new DomainError("conflict", `Another product uses /products/${wanted}.`, "slug");
  for (let n = 2; ; n++) {
    const s = `${wanted}-${n}`;
    if (!(await tx.product.findUnique({ where: { slug: s } }))) return s;
  }
}

/** Keeps search in step with the name, brand, category and specifications. */
export async function refreshSearchText(tx: Tx, id: string) {
  const p = await tx.product.findUniqueOrThrow({ where: { id }, include: { brand: true, category: { include: { parent: true } } } });
  const category = [p.category.parent?.name, p.category.name].filter(Boolean).join(" ");
  await tx.product.update({ where: { id }, data: { searchText: searchTextFor({ name: p.name, brand: p.brand.name, mpn: p.mpn, category, specs: p.specs as SpecValues, summary: p.summary }) } });
}

async function checkCategoryExists(tx: Tx, categoryId: string) {
  if (!(await tx.category.findUnique({ where: { id: categoryId } }))) throw new DomainError("invalid", "Choose a category.", "categoryId");
}

export async function createProduct(db: PrismaClient, actor: StaffActor, input: ProductInput, ip?: string | null): Promise<Product> {
  assertStaffCan(actor, "manageCatalogue");
  const v = checkProduct(input);
  return db.$transaction(async (tx) => {
    await checkCategoryExists(tx, input.categoryId);
    const brand = await brandFor(tx, v.brand);
    if (await tx.product.findUnique({ where: { brandId_mpn: { brandId: brand.id, mpn: v.mpn } } })) throw new DomainError("conflict", `There is already a ${brand.name} product with this part number.`, "mpn");
    const slug = await uniqueSlug(tx, v.slug, null, Boolean(input.slug?.trim()));
    const p = await tx.product.create({
      data: { name: v.name, brandId: brand.id, mpn: v.mpn, mpnKey: mpnKey(v.mpn), categoryId: input.categoryId, slug, summary: v.summary, description: v.description, warrantyMonths: v.warrantyMonths, warrantyTerms: v.warrantyTerms, sellToIndividuals: input.sellToIndividuals, status: input.status, sourcingRule: input.sourcingRule },
    });
    await refreshSearchText(tx, p.id);
    await audit(tx, staffAudit(actor, { action: "product.created", summary: `Added ${brand.name} ${v.name} (${v.mpn})`, targetType: "Product", targetId: p.id, ipAddress: ip }));
    return p;
  });
}

export async function updateProduct(db: PrismaClient, actor: StaffActor, id: string, input: ProductInput, ip?: string | null): Promise<Product> {
  assertStaffCan(actor, "manageCatalogue");
  const v = checkProduct(input);
  return db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id }, include: { brand: true, category: true } });
    if (!before) throw new DomainError("not-found", "No such product.");
    await checkCategoryExists(tx, input.categoryId);
    const brand = await brandFor(tx, v.brand);
    const clash = await tx.product.findUnique({ where: { brandId_mpn: { brandId: brand.id, mpn: v.mpn } } });
    if (clash && clash.id !== id) throw new DomainError("conflict", `There is already a ${brand.name} product with this part number.`, "mpn");
    const slug = input.slug?.trim() ? await uniqueSlug(tx, v.slug, id, true) : before.slug;
    const after = await tx.product.update({
      where: { id },
      data: { name: v.name, brandId: brand.id, mpn: v.mpn, mpnKey: mpnKey(v.mpn), categoryId: input.categoryId, slug, summary: v.summary, description: v.description, warrantyMonths: v.warrantyMonths, warrantyTerms: v.warrantyTerms, sellToIndividuals: input.sellToIndividuals, status: input.status, sourcingRule: input.sourcingRule },
    });
    await refreshSearchText(tx, id);
    const changes: string[] = [];
    if (before.status !== input.status) changes.push(`status to ${STATUS_LABEL[input.status]}`);
    if (before.name !== v.name || before.brandId !== brand.id) changes.push("name or brand");
    if (before.mpn !== v.mpn) changes.push(`part number to ${v.mpn}`);
    if (before.categoryId !== input.categoryId) changes.push("category");
    if (before.sellToIndividuals !== input.sellToIndividuals) changes.push(input.sellToIndividuals ? "sold to individuals" : "sold to businesses only");
    if (before.sourcingRule !== input.sourcingRule) changes.push("supplier rule");
    if (before.slug !== slug) changes.push(`address to /products/${slug}`);
    if (before.summary !== v.summary || before.description !== v.description || before.warrantyMonths !== v.warrantyMonths || before.warrantyTerms !== v.warrantyTerms) changes.push("details");
    if (changes.length) await audit(tx, staffAudit(actor, { action: "product.updated", summary: `Changed ${before.brand.name} ${before.name}: ${changes.join(", ")}`, targetType: "Product", targetId: id, ipAddress: ip }));
    return after;
  });
}

/**
 * Saves the specification values typed into the form, by field key.
 * Values for fields the category doesn't have are kept, so moving a
 * product between categories loses nothing.
 */
export async function saveSpecs(db: PrismaClient, actor: StaffActor, id: string, raw: Record<string, string>, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id }, include: { brand: true, category: { include: { specFields: true, parent: { include: { specFields: true } } } } } });
    if (!p) throw new DomainError("not-found", "No such product.");
    const specs: SpecValues = { ...(p.specs as SpecValues) };
    const fieldErrors: Record<string, string> = {};
    for (const f of specFieldsOf(p.category)) {
      if (!(f.key in raw)) continue;
      const { value, error } = parseSpecValue(f, raw[f.key]);
      if (error) fieldErrors[`spec.${f.key}`] = error;
      else if (value === undefined) delete specs[f.key];
      else specs[f.key] = value;
    }
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    await tx.product.update({ where: { id }, data: { specs } });
    await refreshSearchText(tx, id);
    await audit(tx, staffAudit(actor, { action: "product.specs", summary: `Changed the specifications of ${p.brand.name} ${p.name}`, targetType: "Product", targetId: id, ipAddress: ip }));
  });
}

// ─── Products that go together ───────────────────────────────────────

/** Finds a product by part number, or by the end of its address. */
async function findByReference(tx: Tx, reference: string) {
  const ref = reference.trim();
  const bySlug = await tx.product.findUnique({ where: { slug: ref.replace(/^.*\/products\//, "").replace(/[?#].*$/, "") } });
  if (bySlug) return bySlug;
  const byMpn = await tx.product.findMany({ where: { mpnKey: mpnKey(ref) }, take: 2 });
  if (byMpn.length > 1) throw new DomainError("conflict", "Several products have that part number. Paste the product's address instead.", "reference");
  if (!byMpn.length) throw new DomainError("not-found", "No product has that part number or address.", "reference");
  return byMpn[0];
}

export async function linkProducts(db: PrismaClient, actor: StaffActor, id: string, reference: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id } });
    if (!p) throw new DomainError("not-found", "No such product.");
    const other = await findByReference(tx, reference);
    if (other.id === id) throw new DomainError("invalid", "A product can't go with itself.", "reference");
    const [a, b] = [id, other.id].sort();
    await tx.productLink.upsert({ where: { productId_relatedId: { productId: a, relatedId: b } }, create: { productId: a, relatedId: b }, update: {} });
    await audit(tx, staffAudit(actor, { action: "product.linked", summary: `Linked ${p.name} with ${other.name}`, targetType: "Product", targetId: id, ipAddress: ip }));
  });
}

export async function unlinkProducts(db: PrismaClient, actor: StaffActor, id: string, otherId: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  const [a, b] = [id, otherId].sort();
  await db.$transaction(async (tx) => {
    const link = await tx.productLink.findUnique({ where: { productId_relatedId: { productId: a, relatedId: b } }, include: { product: true, related: true } });
    if (!link) return;
    await tx.productLink.delete({ where: { productId_relatedId: { productId: a, relatedId: b } } });
    await audit(tx, staffAudit(actor, { action: "product.unlinked", summary: `Unlinked ${link.product.name} and ${link.related.name}`, targetType: "Product", targetId: id, ipAddress: ip }));
  });
}
