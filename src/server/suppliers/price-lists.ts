import type { ImportSchedule, Prisma, PrismaClient, PriceListFormat, PriceListImport, RowChange } from "@prisma/client";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mpnKey, slugify } from "@/lib/catalogue";
import { guessColumns, missingColumns, parseCsv, priceMoveBps, PRICE_LIST_FIELD_KEYS, readLines, type ColumnMap, type ParsedLine, type Table } from "@/lib/price-list";
import { audit, staffAudit, SYSTEM_ACTOR, type AuditInput } from "@/server/audit";
import { brandFor, refreshSearchText } from "@/server/catalogue/products";
import { DomainError } from "@/server/errors";
import { refreshCosts } from "@/server/shop/costs";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Supplier price lists. Staff upload a CSV or Excel file (or the server
 * fetches it on a schedule); we read it with the supplier's saved column
 * map, compare every line with their current offers, and show the
 * changes for review. Nothing changes until someone applies it, unless
 * the supplier is set to apply small changes by itself.
 */

export const MAX_LIST_BYTES = 10 * 1024 * 1024;
const MAX_LINES = 20_000;
/** Files kept with their import, per supplier; older ones keep only their lines. */
const KEEP_FILES = 10;

type Tx = Prisma.TransactionClient;
type Who = StaffActor | null;

function auditAs(who: Who, rest: Omit<AuditInput, "actorKind" | "actorUserId" | "actorLabel">): AuditInput {
  return who ? staffAudit(who, rest) : { ...SYSTEM_ACTOR, actorLabel: "Scheduled price list", ...rest };
}

// ─── Reading files ───────────────────────────────────────────────────

/** CSV or Excel (.xlsx) into a table of cells. Excel reads the named sheet, or the first. */
export async function readTable(bytes: Uint8Array, filename: string, sheet?: string | null): Promise<{ table: Table; sheets: string[] }> {
  const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b; // a zip file, as .xlsx files are
  if (isXlsx) {
    const readXlsx = (await import("read-excel-file/node")).default;
    let sheets: { sheet: string; data: Table }[];
    try {
      sheets = (await readXlsx(Buffer.from(bytes))) as { sheet: string; data: Table }[];
    } catch {
      throw new DomainError("invalid", "That Excel file can't be read. Save it again as .xlsx or CSV.", "file");
    }
    const names = sheets.map((s) => s.sheet);
    const chosen = sheet ? sheets.find((s) => s.sheet === sheet) : sheets[0];
    if (!chosen) throw new DomainError("invalid", `The file has no sheet called ${sheet}. It has ${names.join(", ")}.`, "sheet");
    return { table: chosen.data, sheets: names };
  }
  if (/\.xls$/i.test(filename) || bytes[0] === 0xd0) throw new DomainError("invalid", "Old .xls files can't be read. Save it as .xlsx or CSV first.", "file");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\u0000")) throw new DomainError("invalid", "Upload a CSV or Excel (.xlsx) file.", "file");
  return { table: parseCsv(text), sheets: [] };
}

export function headersOf(table: Table, headerRow: number): string[] {
  return (table[Math.max(0, headerRow - 1)] ?? []).map((c) => (c === null || c === undefined ? "" : String(c).trim()));
}

// ─── Comparing ───────────────────────────────────────────────────────

interface ComparedRow {
  line: ParsedLine | null;
  change: RowChange;
  productId?: string;
  previousCostMinor?: bigint;
  movedBps?: number;
  error?: string;
}

/**
 * Matches each line to a product: the supplier's own code on an existing
 * offer first, then the part number (and brand, when the list has one).
 * Offers the list no longer has come back as MISSING.
 */
async function compare(tx: Tx, supplierId: string, lines: ParsedLine[]): Promise<ComparedRow[]> {
  const offers = await tx.supplierOffer.findMany({ where: { supplierId }, select: { id: true, productId: true, supplierSku: true, costMinor: true, currency: true, active: true, product: { select: { mpnKey: true } } } });
  const bySku = new Map(offers.filter((o) => o.supplierSku).map((o) => [o.supplierSku!.toUpperCase(), o]));
  const byProduct = new Map(offers.map((o) => [o.productId, o]));
  const keys = [...new Set(lines.map((l) => l.mpnKey).filter(Boolean))];
  const products = keys.length ? await tx.product.findMany({ where: { mpnKey: { in: keys } }, select: { id: true, mpnKey: true, brand: { select: { name: true } } } }) : [];
  const productsByKey = new Map<string, typeof products>();
  for (const p of products) productsByKey.set(p.mpnKey, [...(productsByKey.get(p.mpnKey) ?? []), p]);

  const seen = new Set<string>();
  const out: ComparedRow[] = [];
  for (const line of lines) {
    if (line.error) {
      out.push({ line, change: "INVALID", error: line.error });
      continue;
    }
    let productId: string | undefined = line.supplierSku ? bySku.get(line.supplierSku.toUpperCase())?.productId : undefined;
    if (!productId) {
      let candidates = productsByKey.get(line.mpnKey) ?? [];
      if (candidates.length > 1 && line.brand) candidates = candidates.filter((p) => p.brand.name.toLowerCase() === line.brand!.toLowerCase());
      if (candidates.length > 1) {
        out.push({ line, change: "UNMATCHED", error: "Several products have this part number. Add a brand column to the list." });
        continue;
      }
      productId = candidates[0]?.id;
    }
    if (!productId) {
      out.push({ line, change: "UNMATCHED" });
      continue;
    }
    if (seen.has(productId)) {
      out.push({ line, change: "INVALID", productId, error: "The same product appears earlier in the list." });
      continue;
    }
    seen.add(productId);
    const offer = byProduct.get(productId);
    if (!offer) {
      out.push({ line, change: "NEW_OFFER", productId });
      continue;
    }
    const sameCurrency = offer.currency === line.currency;
    const moved = sameCurrency ? priceMoveBps(offer.costMinor, line.costMinor!) : undefined;
    const change: RowChange = !sameCurrency ? "PRICE_UP" : line.costMinor! > offer.costMinor ? "PRICE_UP" : line.costMinor! < offer.costMinor ? "PRICE_DOWN" : "UNCHANGED";
    out.push({ line, change, productId, previousCostMinor: offer.costMinor, movedBps: moved, error: sameCurrency ? undefined : `Was in ${offer.currency}, now in ${line.currency}.` });
  }
  for (const o of offers) if (o.active && !seen.has(o.productId)) out.push({ line: null, change: "MISSING", productId: o.productId, previousCostMinor: o.costMinor });
  return out;
}

function summarise(rows: ComparedRow[]) {
  const summary: Partial<Record<RowChange, number>> = {};
  let largest: number | null = null;
  for (const r of rows) {
    summary[r.change] = (summary[r.change] ?? 0) + 1;
    if (r.movedBps !== undefined && (largest === null || r.movedBps > largest)) largest = r.movedBps;
    // A change of currency can't be measured, so it counts as a large move.
    if (r.change === "PRICE_UP" && r.movedBps === undefined) largest = Number.MAX_SAFE_INTEGER;
  }
  return { summary, largestMoveBps: largest === Number.MAX_SAFE_INTEGER ? 1_000_000 : largest };
}

async function writeRows(tx: Tx, importId: string, supplierCurrency: string, rows: ComparedRow[]) {
  const offers = rows.filter((r) => r.change === "MISSING" && r.productId);
  const products = offers.length ? await tx.product.findMany({ where: { id: { in: offers.map((r) => r.productId!) } }, select: { id: true, mpn: true, name: true, brand: { select: { name: true } } } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const data: Prisma.PriceListRowCreateManyInput[] = rows.map((r) => ({
    importId,
    line: r.line?.line ?? 0,
    change: r.change,
    mpn: r.line?.mpn ?? byId.get(r.productId!)?.mpn ?? "",
    brand: r.line?.brand ?? byId.get(r.productId!)?.brand.name ?? null,
    name: r.line?.name ?? byId.get(r.productId!)?.name ?? null,
    supplierSku: r.line?.supplierSku ?? null,
    costMinor: r.line?.costMinor ?? null,
    currency: r.line?.currency ?? supplierCurrency,
    stock: r.line?.stock ?? null,
    leadTimeDays: r.line?.leadTimeDays ?? null,
    moq: r.line?.moq ?? null,
    productId: r.productId ?? null,
    previousCostMinor: r.previousCostMinor ?? null,
    movedBps: r.movedBps ?? null,
    error: r.error ?? null,
  }));
  for (let i = 0; i < data.length; i += 1000) await tx.priceListRow.createMany({ data: data.slice(i, i + 1000) });
}

// ─── Importing ───────────────────────────────────────────────────────

export interface ImportFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Reads a new price list. With a saved column map that fits the file,
 * the lines are compared straight away (READY). Otherwise the import
 * waits for staff to map the columns (NEEDS_COLUMNS).
 */
export async function startImport(db: PrismaClient, who: Who, supplierId: string, file: ImportFile, origin: "upload" | "schedule", ip?: string | null): Promise<PriceListImport> {
  if (who) assertStaffCan(who, "importPriceLists");
  if (!file.bytes.length) throw new DomainError("invalid", "Choose a file.", "file");
  if (file.bytes.length > MAX_LIST_BYTES) throw new DomainError("invalid", "Price lists can be up to 10 MB. Split it, or save it as CSV.", "file");
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, include: { format: true } });
  if (!supplier) throw new DomainError("not-found", "No such supplier.");
  const filename = file.name.replace(/[^\w .()-]/g, "").slice(0, 120) || "price-list";
  const { table } = await readTable(file.bytes, filename, supplier.format?.sheet);
  if (table.length > MAX_LINES) throw new DomainError("invalid", `Price lists can have up to ${MAX_LINES.toLocaleString("en")} lines.`, "file");
  const format = supplier.format;
  const fits = format && !missingColumns(format.columns as ColumnMap, headersOf(table, format.headerRow)).length;
  return db.$transaction(
    async (tx) => {
      const imp = await tx.priceListImport.create({ data: { supplierId, filename, origin, file: file.bytes, status: fits ? "READY" : "NEEDS_COLUMNS", createdById: who?.userId ?? null, createdByLabel: who?.name ?? "Schedule" } });
      if (fits) await readImport(tx, imp.id, supplier.currency, format, table);
      await audit(tx, auditAs(who, { action: "price-list.uploaded", summary: `${origin === "schedule" ? "Fetched" : "Uploaded"} a price list from ${supplier.name}${fits ? "" : ", waiting for its columns"}`, targetType: "Supplier", targetId: supplierId, ipAddress: ip }));
      await trimFiles(tx, supplierId);
      return tx.priceListImport.findUniqueOrThrow({ where: { id: imp.id } });
    },
    { timeout: 60_000 },
  );
}

async function readImport(tx: Tx, importId: string, supplierCurrency: string, format: Pick<PriceListFormat, "columns" | "headerRow" | "currency">, table: Table) {
  const { lines } = readLines(table, format.columns as ColumnMap, { headerRow: format.headerRow, currency: format.currency ?? supplierCurrency });
  const imp = await tx.priceListImport.findUniqueOrThrow({ where: { id: importId } });
  const rows = await compare(tx, imp.supplierId, lines);
  await tx.priceListRow.deleteMany({ where: { importId } });
  await writeRows(tx, importId, supplierCurrency, rows);
  const { summary, largestMoveBps } = summarise(rows);
  await tx.priceListImport.update({ where: { id: importId }, data: { status: "READY", summary, largestMoveBps } });
}

async function trimFiles(tx: Tx, supplierId: string) {
  const old = await tx.priceListImport.findMany({ where: { supplierId, file: { not: null } }, orderBy: { createdAt: "desc" }, skip: KEEP_FILES, select: { id: true } });
  if (old.length) await tx.priceListImport.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { file: null } });
}

/** The headings and first lines of an import's file, for mapping its columns. */
export async function columnPreview(db: PrismaClient, importId: string, sheet?: string | null, headerRow?: number) {
  const imp = await db.priceListImport.findUnique({ where: { id: importId }, include: { supplier: { include: { format: true } } } });
  if (!imp) throw new DomainError("not-found", "No such price list.");
  if (!imp.file) throw new DomainError("invalid", "This price list's file is no longer kept. Upload it again.");
  const format = imp.supplier.format;
  const { table, sheets } = await readTable(imp.file, imp.filename, sheet ?? format?.sheet);
  const row = headerRow ?? format?.headerRow ?? 1;
  const headers = headersOf(table, row);
  const saved = (format?.columns ?? {}) as ColumnMap;
  const guessed = guessColumns(headers);
  const columns: ColumnMap = Object.fromEntries(PRICE_LIST_FIELD_KEYS.map((f) => [f, saved[f] && headers.includes(saved[f]!) ? saved[f] : guessed[f]]).filter(([, v]) => v));
  return { import: imp, headers, sheets, sheet: sheet ?? format?.sheet ?? sheets[0] ?? null, headerRow: row, columns, sample: table.slice(row, row + 5), currency: format?.currency ?? null };
}

export interface ColumnsInput {
  columns: ColumnMap;
  sheet: string | null;
  headerRow: number;
  currency: string | null;
}

/** Saves which column is which for this supplier, then reads the waiting import with it. */
export async function saveColumns(db: PrismaClient, actor: StaffActor, importId: string, input: ColumnsInput, ip?: string | null) {
  assertStaffCan(actor, "importPriceLists");
  const imp = await db.priceListImport.findUnique({ where: { id: importId }, include: { supplier: true } });
  if (!imp) throw new DomainError("not-found", "No such price list.");
  if (imp.status === "APPLIED" || imp.status === "DISCARDED") throw new DomainError("conflict", "This price list has already been dealt with.");
  if (!imp.file) throw new DomainError("invalid", "This price list's file is no longer kept. Upload it again.");
  if (!Number.isInteger(input.headerRow) || input.headerRow < 1 || input.headerRow > 50) throw new DomainError("invalid", "Enter the row number of the headings, 1 to 50.", "headerRow");
  if (input.currency && !(await db.currency.findUnique({ where: { code: input.currency } }))) throw new DomainError("invalid", "Choose a currency.", "currency");
  const { table } = await readTable(imp.file, imp.filename, input.sheet);
  const headers = headersOf(table, input.headerRow);
  const columns: ColumnMap = Object.fromEntries(Object.entries(input.columns).filter(([k, v]) => v && PRICE_LIST_FIELD_KEYS.includes(k as never)));
  const missing = missingColumns(columns, headers);
  if (missing.length) throw new DomainError("invalid", "Choose the column for the part number and the cost.", undefined, Object.fromEntries(missing.map((f) => [`col.${f}`, "Choose a column."])));
  const values = new Set(Object.values(columns));
  if (values.size !== Object.values(columns).length) throw new DomainError("invalid", "Each column can be used for one thing only.");
  await db.$transaction(
    async (tx) => {
      const data = { columns, sheet: input.sheet, headerRow: input.headerRow, currency: input.currency };
      await tx.priceListFormat.upsert({ where: { supplierId: imp.supplierId }, create: { supplierId: imp.supplierId, ...data }, update: data });
      await readImport(tx, importId, imp.supplier.currency, data, table);
      await audit(tx, staffAudit(actor, { action: "price-list.columns", summary: `Saved how to read ${imp.supplier.name}'s price lists`, targetType: "Supplier", targetId: imp.supplierId, ipAddress: ip }));
    },
    { timeout: 60_000 },
  );
}

export async function getImport(db: PrismaClient, importId: string, show?: RowChange) {
  const imp = await db.priceListImport.findUnique({ where: { id: importId }, include: { supplier: { include: { format: true } } } });
  if (!imp) throw new DomainError("not-found", "No such price list.");
  const rows = await db.priceListRow.findMany({ where: { importId, ...(show ? { change: show } : { change: { not: "UNCHANGED" } }) }, orderBy: [{ change: "asc" }, { line: "asc" }], take: 500 });
  const newer = await db.priceListImport.count({ where: { supplierId: imp.supplierId, createdAt: { gt: imp.createdAt }, status: { in: ["READY", "APPLIED", "NEEDS_COLUMNS"] } } });
  return { import: imp, rows, newer };
}

/** Imports waiting for someone to look at them, for the overview and the menu. */
export async function waitingImports(db: Pick<PrismaClient, "priceListImport">) {
  return db.priceListImport.count({ where: { status: { in: ["READY", "NEEDS_COLUMNS"] } } });
}

// ─── Applying ────────────────────────────────────────────────────────

export interface ApplyOptions {
  deactivateMissing: boolean;
  /** Add unmatched lines that have a brand and name as draft products in this category. */
  draftsCategoryId?: string | null;
}

/**
 * Applies a READY import: offers are added or updated from the lines as
 * they compare now (not when the file was read), so a change made in
 * between is never undone. Only the newest list from a supplier can be
 * applied.
 */
export async function applyImport(db: PrismaClient, who: Who, importId: string, opts: ApplyOptions, ip?: string | null, now = new Date()) {
  if (who) assertStaffCan(who, "importPriceLists");
  const counts = await db.$transaction(
    async (tx) => {
      const imp = await tx.priceListImport.findUnique({ where: { id: importId }, include: { supplier: true } });
      if (!imp) throw new DomainError("not-found", "No such price list.");
      if (imp.status !== "READY") throw new DomainError("conflict", "This price list has already been dealt with, or still needs its columns.");
      const newer = await tx.priceListImport.findFirst({ where: { supplierId: imp.supplierId, createdAt: { gt: imp.createdAt }, status: { not: "DISCARDED" } } });
      if (newer) throw new DomainError("conflict", "A newer price list from this supplier has arrived. Review that one instead.");
      if (opts.draftsCategoryId && !(await tx.category.findUnique({ where: { id: opts.draftsCategoryId } }))) throw new DomainError("invalid", "Choose a category for the new products.", "draftsCategoryId");

      const stored = await tx.priceListRow.findMany({ where: { importId, change: { notIn: ["INVALID", "MISSING"] } }, orderBy: { line: "asc" } });
      const lines: ParsedLine[] = stored.map((r) => ({ line: r.line, mpn: r.mpn, mpnKey: mpnKey(r.mpn), brand: r.brand ?? undefined, name: r.name ?? undefined, supplierSku: r.supplierSku ?? undefined, costMinor: r.costMinor ?? undefined, currency: r.currency, stock: r.stock ?? undefined, leadTimeDays: r.leadTimeDays ?? undefined, moq: r.moq ?? undefined }));
      const rows = await compare(tx, imp.supplierId, lines);
      const counts = { added: 0, updated: 0, drafts: 0, switchedOff: 0 };
      for (const r of rows) {
        const l = r.line;
        if (r.change === "MISSING") {
          if (opts.deactivateMissing) {
            await tx.supplierOffer.update({ where: { supplierId_productId: { supplierId: imp.supplierId, productId: r.productId! } }, data: { active: false } });
            counts.switchedOff++;
          }
          continue;
        }
        if (!l || r.change === "INVALID") continue;
        let productId = r.productId;
        if (r.change === "UNMATCHED") {
          if (!opts.draftsCategoryId || !l.brand || !l.name || r.error) continue;
          productId = await draftProduct(tx, l, opts.draftsCategoryId);
          if (!productId) continue;
          counts.drafts++;
        }
        const data = { costMinor: l.costMinor!, currency: l.currency, stock: l.stock ?? null, leadTimeDays: l.leadTimeDays ?? null, moq: l.moq ?? 1, active: true, source: "import" };
        const key = { supplierId_productId: { supplierId: imp.supplierId, productId: productId! } };
        const existing = await tx.supplierOffer.findUnique({ where: key });
        if (existing) {
          await tx.supplierOffer.update({ where: key, data: { ...data, ...(l.supplierSku ? { supplierSku: l.supplierSku } : {}), ...(existing.costMinor !== data.costMinor || existing.currency !== data.currency ? { priceUpdatedAt: now } : {}) } });
          counts.updated++;
        } else {
          await tx.supplierOffer.create({ data: { ...data, supplierId: imp.supplierId, productId: productId!, supplierSku: l.supplierSku ?? null, priceUpdatedAt: now } });
          counts.added++;
        }
      }
      await tx.priceListImport.update({ where: { id: importId }, data: { status: "APPLIED", decidedAt: now, decidedByLabel: who?.name ?? "Applied by itself" } });
      await tx.priceListImport.updateMany({ where: { supplierId: imp.supplierId, status: { in: ["READY", "NEEDS_COLUMNS"] }, createdAt: { lt: imp.createdAt } }, data: { status: "DISCARDED", decidedAt: now, decidedByLabel: "Replaced by a newer list" } });
      const parts = [`${counts.updated} offers updated`, `${counts.added} added`];
      if (counts.drafts) parts.push(`${counts.drafts} draft products made`);
      if (counts.switchedOff) parts.push(`${counts.switchedOff} switched off`);
      await audit(tx, auditAs(who, { action: "price-list.applied", summary: `Applied ${imp.supplier.name}'s price list: ${parts.join(", ")}`, targetType: "Supplier", targetId: imp.supplierId, data: counts, ipAddress: ip }));
      return { ...counts, supplierId: imp.supplierId };
    },
    { timeout: 120_000 },
  );
  const products = await db.supplierOffer.findMany({ where: { supplierId: counts.supplierId }, select: { productId: true } });
  await refreshCosts(db, products.map((p) => p.productId), now);
  const { supplierId: _supplier, ...rest } = counts;
  return rest;
}

/** A draft product from a price list line, for staff to finish before it goes in the shop. */
async function draftProduct(tx: Tx, l: ParsedLine, categoryId: string): Promise<string | undefined> {
  const brand = await brandFor(tx, l.brand!);
  const existing = await tx.product.findUnique({ where: { brandId_mpn: { brandId: brand.id, mpn: l.mpn } } });
  if (existing) return existing.id;
  let slug = slugify(`${brand.name} ${l.name}`) || slugify(l.mpn) || "product";
  if (await tx.product.findUnique({ where: { slug } })) slug = `${slug}-${mpnKey(l.mpn).toLowerCase()}`.slice(0, 90);
  if (await tx.product.findUnique({ where: { slug } })) return undefined;
  const p = await tx.product.create({ data: { name: l.name!.slice(0, 160), brandId: brand.id, mpn: l.mpn, mpnKey: l.mpnKey, categoryId, slug, status: "DRAFT" } });
  await refreshSearchText(tx, p.id);
  return p.id;
}

export async function discardImport(db: PrismaClient, actor: StaffActor, importId: string, ip?: string | null) {
  assertStaffCan(actor, "importPriceLists");
  await db.$transaction(async (tx) => {
    const imp = await tx.priceListImport.findUnique({ where: { id: importId }, include: { supplier: true } });
    if (!imp || imp.status === "APPLIED" || imp.status === "DISCARDED") return;
    await tx.priceListImport.update({ where: { id: importId }, data: { status: "DISCARDED", decidedAt: new Date(), decidedByLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "price-list.discarded", summary: `Discarded a price list from ${imp.supplier.name}`, targetType: "Supplier", targetId: imp.supplierId, ipAddress: ip }));
  });
}

// ─── Scheduled re-imports ────────────────────────────────────────────

export interface ScheduleInput {
  sourceUrl: string;
  schedule: ImportSchedule;
  /** Empty: always wait for review. */
  autoApplyPercent: string;
  deactivateMissing: boolean;
}

export async function saveSchedule(db: PrismaClient, actor: StaffActor, supplierId: string, input: ScheduleInput, ip?: string | null) {
  assertStaffCan(actor, "importPriceLists");
  const fieldErrors: Record<string, string> = {};
  const sourceUrl = input.sourceUrl.trim() || null;
  if (sourceUrl) {
    try {
      if (new URL(sourceUrl).protocol !== "https:") throw new Error();
    } catch {
      fieldErrors.sourceUrl = "Enter an https address that serves the file.";
    }
  }
  if (input.schedule !== "OFF" && !sourceUrl) fieldErrors.sourceUrl = "A schedule needs the address to fetch from.";
  if (!["OFF", "DAILY", "WEEKLY"].includes(input.schedule)) fieldErrors.schedule = "Choose how often.";
  let autoApplyBps: number | null = null;
  if (input.autoApplyPercent.trim()) {
    const n = Number(input.autoApplyPercent);
    if (!Number.isFinite(n) || n < 0 || n > 50) fieldErrors.autoApplyPercent = "Enter a percentage from 0 to 50, or leave it empty.";
    else autoApplyBps = Math.round(n * 100);
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id: supplierId }, include: { format: true } });
    if (!s) throw new DomainError("not-found", "No such supplier.");
    if (!s.format && input.schedule !== "OFF") throw new DomainError("invalid", "Import one list by hand first, so we know how to read it.", "schedule");
    const data = { sourceUrl, schedule: input.schedule, autoApplyBps, deactivateMissing: input.deactivateMissing };
    await tx.priceListFormat.upsert({ where: { supplierId }, create: { supplierId, columns: {}, ...data }, update: data });
    await audit(tx, staffAudit(actor, { action: "price-list.schedule", summary: `Set ${s.name}'s price list to ${input.schedule === "OFF" ? "manual imports" : `${input.schedule.toLowerCase()} imports`}${autoApplyBps !== null ? `, applying by itself under ${autoApplyBps / 100}%` : ""}`, targetType: "Supplier", targetId: supplierId, ipAddress: ip }));
  });
}

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:/i];

/** Fetches a price list from a supplier's address: https only, public addresses only, 10 MB at most. */
export async function fetchList(url: string, fetchImpl: typeof fetch = fetch): Promise<ImportFile> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Only https addresses are fetched.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some((a) => PRIVATE.some((p) => p.test(a)))) throw new Error("The address points inside a private network.");
  const res = await fetchImpl(u, { redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "user-agent": "ICT Distribution price list import" } });
  if (!res.ok) throw new Error(`The supplier's server answered ${res.status}.`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_LIST_BYTES) throw new Error("The file is over 10 MB.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_LIST_BYTES) throw new Error("The file is over 10 MB.");
  const name = decodeURIComponent(u.pathname.split("/").pop() || "price-list.csv");
  return { name, bytes };
}

const DUE_MS: Record<ImportSchedule, number> = { OFF: Infinity, DAILY: 23 * 60 * 60 * 1000, WEEKLY: 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000 };

/**
 * The hourly job: fetches each scheduled list that is due, reads it, and
 * applies it by itself when no matched price moved more than the
 * supplier's limit and nothing needs a decision. Otherwise it waits for
 * review. Failures are kept on the supplier for staff to see.
 */
export async function runScheduledImports(db: PrismaClient, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const due = await db.priceListFormat.findMany({ where: { schedule: { not: "OFF" }, sourceUrl: { not: null }, supplier: { active: true } } });
  const results: string[] = [];
  for (const f of due) {
    if (f.lastFetchedAt && now.getTime() - f.lastFetchedAt.getTime() < DUE_MS[f.schedule]) continue;
    try {
      const file = await fetchList(f.sourceUrl!, fetchImpl);
      const imp = await startImport(db, null, f.supplierId, file, "schedule");
      await db.priceListFormat.update({ where: { supplierId: f.supplierId }, data: { lastFetchedAt: now, lastFetchError: null } });
      const summary = imp.summary as Partial<Record<RowChange, number>>;
      const needsDecision = (summary.INVALID ?? 0) > 0 || ((summary.MISSING ?? 0) > 0 && f.deactivateMissing);
      if (imp.status === "READY" && f.autoApplyBps !== null && !needsDecision && (imp.largestMoveBps ?? 0) <= f.autoApplyBps) {
        await applyImport(db, null, imp.id, { deactivateMissing: false }, null, now);
        results.push(`${f.supplierId}: applied`);
      } else results.push(`${f.supplierId}: waiting for review`);
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
      await db.priceListFormat.update({ where: { supplierId: f.supplierId }, data: { lastFetchedAt: now, lastFetchError: message } });
      results.push(`${f.supplierId}: ${message}`);
    }
  }
  return results;
}
