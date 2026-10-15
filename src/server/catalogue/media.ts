import type { MediaKind, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Product images and datasheets, kept in the database so every backup
 * holds them. Images are checked by their content, not their name, and
 * stored as WebP at two sizes: one for the product page and a small one
 * for cards. Datasheets must be PDFs.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DATASHEET_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES = 12;
export const MAX_DATASHEETS = 6;
const LARGE = 1600;
const THUMB = 480;

export interface Upload {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

function startsWith(b: Uint8Array, sig: number[], offset = 0) {
  return sig.every((x, i) => b[offset + i] === x);
}

/** JPEG, PNG, WebP or AVIF, by the first bytes of the file. SVG is refused: it can carry scripts. */
export function imageType(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) && /^(avif|avis|heic|mif1)$/.test(String.fromCharCode(...b.slice(8, 12)))) return "image/avif";
  return null;
}

export function isPdf(b: Uint8Array): boolean {
  return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

function cleanName(name: string, fallback: string) {
  const n = name.replace(/[\\/]/g, "").replace(/[^\w .()-]/g, "").trim().slice(0, 120);
  return n || fallback;
}

async function resize(bytes: Uint8Array) {
  const sharp = (await import("sharp")).default;
  try {
    const img = sharp(bytes, { limitInputPixels: 50_000_000 }).rotate();
    const large = await img.clone().resize({ width: LARGE, height: LARGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await img.clone().resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { large: large.data, width: large.info.width, height: large.info.height, thumb };
  } catch {
    throw new DomainError("invalid", "That image can't be read. Try saving it again as JPEG or PNG.", "file");
  }
}

export async function addImage(db: PrismaClient, actor: StaffActor, productId: string, file: Upload, altInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  const alt = altInput.trim();
  if (!file.bytes.length) throw new DomainError("invalid", "Choose an image.", "file");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new DomainError("invalid", "Images can be up to 8 MB.", "file");
  if (!imageType(file.bytes)) throw new DomainError("invalid", "Use a JPEG, PNG, WebP or AVIF image.", "file");
  if (alt.length < 3 || alt.length > 200) throw new DomainError("invalid", "Say what the image shows, for people who can't see it.", "alt");
  const r = await resize(file.bytes);
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId }, include: { _count: { select: { media: { where: { kind: "IMAGE" } } } } } });
    if (!p) throw new DomainError("not-found", "No such product.");
    if (p._count.media >= MAX_IMAGES) throw new DomainError("invalid", `A product can have up to ${MAX_IMAGES} images.`, "file");
    const last = await tx.productMedia.findFirst({ where: { productId, kind: "IMAGE" }, orderBy: { sortOrder: "desc" } });
    const filename = cleanName(file.name, "image").replace(/\.[a-z0-9]+$/i, "") + ".webp";
    await tx.productMedia.create({ data: { productId, kind: "IMAGE", filename, contentType: "image/webp", bytes: r.large, thumb: r.thumb, width: r.width, height: r.height, size: r.large.length, alt, sortOrder: (last?.sortOrder ?? 0) + 10 } });
    await audit(tx, staffAudit(actor, { action: "product.image-added", summary: `Added an image to ${p.name}`, targetType: "Product", targetId: productId, ipAddress: ip }));
  });
}

export async function addDatasheet(db: PrismaClient, actor: StaffActor, productId: string, file: Upload, titleInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  if (!file.bytes.length) throw new DomainError("invalid", "Choose a PDF.", "file");
  if (file.bytes.length > MAX_DATASHEET_BYTES) throw new DomainError("invalid", "Datasheets can be up to 20 MB.", "file");
  if (!isPdf(file.bytes)) throw new DomainError("invalid", "Datasheets must be PDF files.", "file");
  const filename = cleanName(file.name, "datasheet.pdf").replace(/(\.pdf)?$/i, ".pdf");
  const title = titleInput.trim().slice(0, 120) || "Datasheet";
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId }, include: { _count: { select: { media: { where: { kind: "DATASHEET" } } } } } });
    if (!p) throw new DomainError("not-found", "No such product.");
    if (p._count.media >= MAX_DATASHEETS) throw new DomainError("invalid", `A product can have up to ${MAX_DATASHEETS} datasheets.`, "file");
    await tx.productMedia.create({ data: { productId, kind: "DATASHEET", filename, contentType: "application/pdf", bytes: file.bytes, size: file.bytes.length, alt: title, sortOrder: Date.now() % 1_000_000 } });
    await audit(tx, staffAudit(actor, { action: "product.datasheet-added", summary: `Added the datasheet ${title} to ${p.name}`, targetType: "Product", targetId: productId, ipAddress: ip }));
  });
}

export async function removeMedia(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const m = await tx.productMedia.findUnique({ where: { id }, select: { id: true, kind: true, alt: true, productId: true, product: { select: { name: true } } } });
    if (!m) return;
    await tx.productMedia.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: m.kind === "IMAGE" ? "product.image-removed" : "product.datasheet-removed", summary: `Removed ${m.kind === "IMAGE" ? "an image" : `the datasheet ${m.alt}`} from ${m.product.name}`, targetType: "Product", targetId: m.productId, ipAddress: ip }));
  });
}

/** Moves an image one place earlier. The first image is the one on cards. */
export async function moveImageUp(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  await db.$transaction(async (tx) => {
    const m = await tx.productMedia.findUnique({ where: { id }, select: { id: true, productId: true, kind: true } });
    if (!m) return;
    const list = await tx.productMedia.findMany({ where: { productId: m.productId, kind: m.kind }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const i = list.findIndex((x) => x.id === id);
    if (i <= 0) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    for (const [n, x] of list.entries()) await tx.productMedia.update({ where: { id: x.id }, data: { sortOrder: (n + 1) * 10 } });
    await audit(tx, staffAudit(actor, { action: "product.image-moved", summary: "Changed the order of a product's images", targetType: "Product", targetId: m.productId, ipAddress: ip }));
  });
}

export async function setImageText(db: PrismaClient, actor: StaffActor, id: string, altInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageCatalogue");
  const alt = altInput.trim();
  if (alt.length < 3 || alt.length > 200) throw new DomainError("invalid", "Say what the image shows, in 3 to 200 characters.", "alt");
  const m = await db.productMedia.update({ where: { id }, data: { alt }, select: { productId: true } });
  await audit(db, staffAudit(actor, { action: "product.image-text", summary: "Changed an image description", targetType: "Product", targetId: m.productId, ipAddress: ip }));
}

/**
 * One file for the /media route. Media of products not in the shop is
 * only for staff. Returns null when there is nothing to show this person.
 */
export async function readMedia(db: Pick<PrismaClient, "productMedia">, id: string, opts: { thumb: boolean; staff: boolean }) {
  const m = await db.productMedia.findUnique({
    where: { id },
    select: { kind: true, filename: true, contentType: true, bytes: !opts.thumb, thumb: opts.thumb, product: { select: { status: true, category: { select: { active: true, parent: { select: { active: true } } } } } } },
  });
  if (!m) return null;
  const inShop = m.product.status === "ACTIVE" && m.product.category.active && (m.product.category.parent?.active ?? true);
  if (!inShop && !opts.staff) return null;
  const body = opts.thumb ? (m.thumb ?? null) : (m.bytes ?? null);
  if (!body) return null;
  return { kind: m.kind as MediaKind, filename: m.filename, contentType: m.contentType, body };
}
