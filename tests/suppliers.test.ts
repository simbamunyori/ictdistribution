import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { setRate } from "../src/server/pricing/rates";
import { applyImport, columnPreview, discardImport, fetchList, getImport, runScheduledImports, saveColumns, saveSchedule, startImport } from "../src/server/suppliers/price-lists";
import { productSourcing } from "../src/server/suppliers/sourcing";
import { addContact, createSupplier, performance, recordEvent, saveOffer, type SupplierInput } from "../src/server/suppliers/suppliers";
import { db, hasDb, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex");
type Staff = Awaited<ReturnType<typeof makeStaff>>;

function supplierInput(o: Partial<SupplierInput> = {}): SupplierInput {
  return { name: `Supplier ${tag()}`, kind: "LOCAL", country: "ZA", currency: "ZAR", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "5", preferred: false, active: true, ...o };
}

const csv = (text: string) => ({ name: "list.csv", bytes: new Uint8Array(new TextEncoder().encode(text)) });

let admin: Staff;
let categoryId: string;

async function product(mpn: string, brand = "Ubiquiti") {
  return createProduct(db, admin, { name: `Product ${mpn}`, brand, mpn, categoryId, summary: "", description: "", warrantyMonths: "", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null });
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = await makeStaff("ADMIN");
  categoryId = (await createCategory(db, admin, { name: `Supplied ${tag()}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).id;
});

describe.skipIf(!hasDb)("suppliers", () => {
  it("checks contact details and keeps supplier work to the right roles", async () => {
    await expect(createSupplier(db, await makeStaff("SALES"), supplierInput())).rejects.toThrow(/role/);
    await expect(createSupplier(db, admin, supplierInput({ whatsapp: "0712", currency: "XXX", website: "ftp://x" }))).rejects.toThrow(/highlighted/);
    const s = await createSupplier(db, await makeStaff("PROCUREMENT"), supplierInput({ kind: "CHINA", country: "CN", currency: "USD", whatsapp: "+86 138 0000 0000", landedCostPercent: "18.5" }));
    expect(s).toMatchObject({ whatsapp: "+8613800000000", landedCostBps: 1850 });
    await addContact(db, admin, s.id, { name: "Li Wei", role: "Sales", email: "li@example.cn", phone: "", whatsapp: "+86 139 0000 0000" });
    expect(await db.supplierContact.count({ where: { supplierId: s.id } })).toBe(1);
  });

  it("keeps a performance record", async () => {
    const s = await createSupplier(db, admin, supplierInput());
    const today = new Date().toISOString().slice(0, 10);
    for (const kind of ["ON_TIME", "ON_TIME", "ON_TIME", "LATE", "QUALITY_ISSUE"] as const) await recordEvent(db, admin, s.id, { kind, occurredOn: today, note: "", reference: "" });
    expect(await performance(db, s.id)).toEqual({ deliveries: 4, onTimePercent: 75, problems: 1 });
  });

  it("picks the supplier by the rule in force, in the base currency", async () => {
    await setRate(db, admin, "ZAR", "18.20");
    const p = await product(`SRC-${tag()}`);
    const local = await createSupplier(db, admin, supplierInput({ name: `Local ${tag()}`, leadTimeDays: "2" }));
    const china = await createSupplier(db, admin, supplierInput({ name: `China ${tag()}`, kind: "CHINA", country: "CN", currency: "USD", leadTimeDays: "21", landedCostPercent: "18", preferred: true }));
    await saveOffer(db, admin, { supplierId: local.id, productId: p.id, cost: "13500", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    await saveOffer(db, admin, { supplierId: china.id, productId: p.id, cost: "700", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });

    const cheapest = await productSourcing(db, p.id);
    expect(cheapest.rule).toBe("CHEAPEST_LANDED");
    expect(cheapest.chosen?.offer.supplierId).toBe(local.id);
    expect(cheapest.chosen?.landed).toEqual({ amountMinor: 77_885n, currency: "USD" });
    await db.product.update({ where: { id: p.id }, data: { sourcingRule: "PREFERRED" } });
    const preferred = await productSourcing(db, p.id);
    expect(preferred).toMatchObject({ rule: "PREFERRED", ruleFrom: "this product" });
    expect(preferred.chosen?.offer.supplierId).toBe(china.id);
  });
});

describe.skipIf(!hasDb)("price lists", () => {
  let supplierId: string;
  let a: string;
  let b: string;
  let gone: string;

  beforeEach(async () => {
    supplierId = (await createSupplier(db, admin, supplierInput({ currency: "ZAR" }))).id;
    const t = tag().toUpperCase();
    [a, b, gone] = [`PA-${t}`, `PB-${t}`, `PG-${t}`];
    for (const mpn of [a, b, gone]) {
      const p = await product(mpn);
      await saveOffer(db, admin, { supplierId, productId: p.id, cost: "100.00", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
    }
  });

  const list = () => csv(`Part No;Brand;Description;Dealer Price;Qty\n${a};Ubiquiti;Thing A;110,00;4\n${b.toLowerCase()};Ubiquiti;Thing B;100;\nNEW-${a};Ubiquiti;Brand new thing;55,00;1\n;;;;\nBAD;Ubiquiti;Bad;free;\n`);

  it("asks for the columns once, then reads the supplier's lists by itself", async () => {
    await expect(startImport(db, await makeStaff("SALES"), supplierId, list(), "upload")).rejects.toThrow(/role/);
    const first = await startImport(db, admin, supplierId, list(), "upload");
    expect(first.status).toBe("NEEDS_COLUMNS");
    const preview = await columnPreview(db, first.id);
    expect(preview.columns).toMatchObject({ mpn: "Part No", brand: "Brand", name: "Description", cost: "Dealer Price", stock: "Qty" });
    await expect(saveColumns(db, admin, first.id, { columns: { mpn: "Part No" }, sheet: null, headerRow: 1, currency: null })).rejects.toThrow(/part number and the cost/);
    await saveColumns(db, admin, first.id, { columns: preview.columns, sheet: null, headerRow: 1, currency: null });

    const { import: read, rows } = await getImport(db, first.id);
    expect(read.status).toBe("READY");
    expect(read.summary).toEqual({ PRICE_UP: 1, UNCHANGED: 1, UNMATCHED: 1, INVALID: 1, MISSING: 1 });
    expect(read.largestMoveBps).toBe(1000);
    expect(rows.find((r) => r.change === "PRICE_UP")).toMatchObject({ mpn: a, costMinor: 11_000n, previousCostMinor: 10_000n, movedBps: 1000 });
    expect(rows.find((r) => r.change === "MISSING")?.mpn).toBe(gone);

    const second = await startImport(db, admin, supplierId, list(), "upload");
    expect(second.status).toBe("READY");
  });

  it("applies only the newest list, switches off missing offers and makes drafts when asked", async () => {
    const first = await startImport(db, admin, supplierId, list(), "upload");
    const { columns } = await columnPreview(db, first.id);
    await saveColumns(db, admin, first.id, { columns, sheet: null, headerRow: 1, currency: null });
    const second = await startImport(db, admin, supplierId, list(), "upload");
    await expect(applyImport(db, admin, first.id, { deactivateMissing: false })).rejects.toThrow(/newer/);

    // A cost typed by staff after the list was read is compared again when applying.
    const pb = await db.product.findFirstOrThrow({ where: { mpn: b } });
    await saveOffer(db, admin, { supplierId, productId: pb.id, cost: "90.00", supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });

    const counts = await applyImport(db, admin, second.id, { deactivateMissing: true, draftsCategoryId: categoryId });
    expect(counts).toEqual({ added: 1, updated: 2, drafts: 1, switchedOff: 1 });
    const offers = await db.supplierOffer.findMany({ where: { supplierId }, include: { product: true } });
    const by = (mpn: string) => offers.find((o) => o.product.mpn === mpn)!;
    expect(by(a)).toMatchObject({ costMinor: 11_000n, stock: 4, source: "import" });
    expect(by(b).costMinor).toBe(10_000n);
    expect(by(gone).active).toBe(false);
    expect(by(`NEW-${a}`).product).toMatchObject({ status: "DRAFT", name: "Brand new thing", categoryId });
    expect((await db.priceListImport.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DISCARDED");
    await expect(applyImport(db, admin, second.id, { deactivateMissing: false })).rejects.toThrow(/already/);
  });

  it("reads Excel lists from the named sheet and heading row", async () => {
    await product("XLS-100");
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/price-list.xlsx", import.meta.url)));
    const imp = await startImport(db, admin, supplierId, { name: "list.xlsx", bytes }, "upload");
    const preview = await columnPreview(db, imp.id, "Prices", 2);
    expect(preview.sheets).toEqual(["Notes", "Prices"]);
    expect(preview.columns).toMatchObject({ supplierSku: "Item Code", mpn: "Part No", cost: "Dealer Price", stock: "SOH" });
    await saveColumns(db, admin, imp.id, { columns: preview.columns, sheet: "Prices", headerRow: 2, currency: null });
    const { import: read, rows } = await getImport(db, imp.id, "NEW_OFFER");
    expect(read.summary).toMatchObject({ NEW_OFFER: 1, UNMATCHED: 1 });
    expect(rows[0]).toMatchObject({ mpn: "XLS-100", costMinor: 125_050n, stock: 7, supplierSku: "XL-1" });
    await expect(startImport(db, admin, supplierId, { name: "old.xls", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }, "upload")).rejects.toThrow(/xlsx|CSV/i);
    await discardImport(db, admin, imp.id);
  });

  it("fetches scheduled lists safely and applies small changes by itself", async () => {
    await expect(saveSchedule(db, admin, supplierId, { sourceUrl: "https://example.com/l.csv", schedule: "DAILY", autoApplyPercent: "", deactivateMissing: false })).rejects.toThrow(/by hand first/);
    const first = await startImport(db, admin, supplierId, list(), "upload");
    const { columns } = await columnPreview(db, first.id);
    await saveColumns(db, admin, first.id, { columns, sheet: null, headerRow: 1, currency: null });
    await discardImport(db, admin, first.id);
    await expect(saveSchedule(db, admin, supplierId, { sourceUrl: "http://example.com/l.csv", schedule: "DAILY", autoApplyPercent: "", deactivateMissing: false })).rejects.toThrow(/highlighted/);
    await saveSchedule(db, admin, supplierId, { sourceUrl: "https://93.184.215.14/lists/today.csv", schedule: "DAILY", autoApplyPercent: "5", deactivateMissing: false });

    const small = `Part No;Brand;Description;Dealer Price;Qty\n${a};Ubiquiti;Thing A;104,00;4\n${b};Ubiquiti;Thing B;100;\n${gone};Ubiquiti;Thing G;100;\n`;
    const seen: string[] = [];
    const fake = (async (url: URL, init: RequestInit) => {
      seen.push(`${url} ${init.redirect}`);
      return new Response(small, { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date();
    const results = await runScheduledImports(db, fake, now);
    expect(results).toContain(`${supplierId}: applied`);
    expect(seen).toEqual(["https://93.184.215.14/lists/today.csv error"]);
    const pa = await db.product.findFirstOrThrow({ where: { mpn: a } });
    expect((await db.supplierOffer.findFirstOrThrow({ where: { supplierId, productId: pa.id } })).costMinor).toBe(10_400n);

    // Not due again within the day.
    expect(await runScheduledImports(db, fake, new Date(now.getTime() + 3_600_000))).not.toContain(`${supplierId}: applied`);
    // A big move waits for review.
    const big = small.replace("104,00", "150,00");
    const bigFetch = (async () => new Response(big)) as unknown as typeof fetch;
    expect(await runScheduledImports(db, bigFetch, new Date(now.getTime() + 24 * 3_600_000))).toContain(`${supplierId}: waiting for review`);
    // Failures are kept for staff to see.
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await runScheduledImports(db, down, new Date(now.getTime() + 48 * 3_600_000));
    expect((await db.priceListFormat.findUniqueOrThrow({ where: { supplierId } })).lastFetchError).toMatch(/503/);
  });

  it("refuses to fetch from private networks or over plain http", async () => {
    const never = (async () => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    await expect(fetchList("https://127.0.0.1/x.csv", never)).rejects.toThrow(/private/);
    await expect(fetchList("https://[::1]/x.csv", never)).rejects.toThrow(/private/);
    await expect(fetchList("https://10.1.2.3/x.csv", never)).rejects.toThrow(/private/);
    await expect(fetchList("http://93.184.215.14/x.csv", never)).rejects.toThrow(/https/);
  });
});
