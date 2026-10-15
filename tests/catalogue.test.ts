import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { addSpecField, createCategory, deleteCategory, setSuggestions, updateCategory } from "../src/server/catalogue/categories";
import { addDatasheet, addImage, imageType, moveImageUp, readMedia } from "../src/server/catalogue/media";
import { createProduct, linkProducts, saveSpecs, updateProduct, type ProductInput } from "../src/server/catalogue/products";
import { browse, browseParamsFrom, compareProducts, shopProduct } from "../src/server/catalogue/shop";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { db, hasDb, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex");

type Staff = Awaited<ReturnType<typeof makeStaff>>;

async function category(admin: Staff, name: string, parentId: string | null = null) {
  return createCategory(db, admin, { name: `${name} ${tag()}`, description: "", parentId, sortOrder: 0, active: true, sourcingRule: null });
}

function productInput(categoryId: string, o: Partial<ProductInput> = {}): ProductInput {
  return { name: `Test product ${tag()}`, brand: "Acme", mpn: `T-${tag()}`, categoryId, summary: "", description: "", warrantyMonths: "12", warrantyTerms: "", sellToIndividuals: true, status: "ACTIVE", sourcingRule: null, ...o };
}

const field = (label: string, kind: "TEXT" | "NUMBER" | "YES_NO" | "CHOICE", extra: { unit?: string; options?: string; highlight?: boolean; mustMatch?: boolean; filterable?: boolean } = {}) => ({
  label,
  kind,
  unit: extra.unit ?? "",
  options: extra.options ?? "",
  filterable: extra.filterable ?? true,
  highlight: extra.highlight ?? false,
  mustMatch: extra.mustMatch ?? false,
  sortOrder: 0,
});

describe.skipIf(!hasDb)("categories and specifications", () => {
  let admin: Staff;
  beforeAll(async () => {
    admin = await makeStaff("ADMIN");
  });

  it("only lets catalogue staff change the catalogue", async () => {
    const sales = await makeStaff("SALES");
    await expect(category(sales, "Nope")).rejects.toThrow(/role/);
    const procurement = await makeStaff("PROCUREMENT");
    await expect(category(procurement, "Allowed")).resolves.toBeTruthy();
  });

  it("keeps subcategories one level deep and slugs unique", async () => {
    const top = await category(admin, "Networking");
    const sub = await category(admin, "Switches", top.id);
    await expect(category(admin, "Deeper", sub.id)).rejects.toThrow(/one level/);
    await expect(updateCategory(db, admin, top.id, { name: top.name, description: "", parentId: sub.id, sortOrder: 0, active: true, sourcingRule: null })).rejects.toThrow();
    await expect(createCategory(db, admin, { name: "Clash", slug: top.slug, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null })).rejects.toThrow(/already used/);
    await expect(deleteCategory(db, admin, top.id)).rejects.toThrow();
  });

  it("keeps specification keys unique across a category family", async () => {
    const top = await category(admin, "Computers");
    const sub = await category(admin, "Laptops", top.id);
    await addSpecField(db, admin, top.id, field("Memory", "NUMBER", { unit: "GB" }));
    await expect(addSpecField(db, admin, sub.id, field("Memory", "NUMBER"))).rejects.toThrow(/memory/i);
    await expect(addSpecField(db, admin, sub.id, field("Panel", "CHOICE", { options: "IPS" }))).rejects.toThrow(/highlighted/);
  });
});

describe.skipIf(!hasDb)("products", () => {
  let admin: Staff;
  let cat: Awaited<ReturnType<typeof category>>;
  beforeAll(async () => {
    admin = await makeStaff("ADMIN");
    cat = await category(admin, "Memory");
    await addSpecField(db, admin, cat.id, field("Capacity", "NUMBER", { unit: "GB", highlight: true }));
    await addSpecField(db, admin, cat.id, field("Type", "CHOICE", { options: "DDR4\nDDR5" }));
  });

  it("refuses a second product with the same brand and part number", async () => {
    const p = await createProduct(db, admin, productInput(cat.id, { brand: "Kingston", mpn: "KVR-1" }));
    expect(p.mpnKey).toBe("KVR1");
    await expect(createProduct(db, admin, productInput(cat.id, { brand: "kingston", mpn: "KVR-1" }))).rejects.toThrow(/already/);
    await expect(createProduct(db, admin, productInput(cat.id, { name: "x" }))).rejects.toThrow(/highlighted/);
  });

  it("gives a free address when the name is taken", async () => {
    const a = await createProduct(db, admin, productInput(cat.id, { name: "Same name stick", brand: "Corsair" }));
    const b = await createProduct(db, admin, productInput(cat.id, { name: "Same name stick", brand: "Corsair" }));
    expect(b.slug).toBe(`${a.slug}-2`);
  });

  it("checks specification values and keeps search in step", async () => {
    const p = await createProduct(db, admin, productInput(cat.id, { name: "Fury stick" }));
    await expect(saveSpecs(db, admin, p.id, { capacity: "lots" })).rejects.toThrow(/highlighted/);
    await saveSpecs(db, admin, p.id, { capacity: "32", type: "ddr5" });
    const saved = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(saved.specs).toEqual({ capacity: 32, type: "DDR5" });
    expect(saved.searchText).toContain("ddr5");
    await updateProduct(db, admin, p.id, productInput(cat.id, { name: "Fury Beast stick", mpn: p.mpn }));
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).searchText).toContain("fury beast");
  });

  it("stores images resized, and datasheets as PDF only", async () => {
    const p = await createProduct(db, admin, productInput(cat.id));
    const png = new Uint8Array(await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#0a5" } }).png().toBuffer());
    expect(imageType(png)).toBe("image/png");
    await expect(addImage(db, admin, p.id, { name: "a.svg", bytes: new TextEncoder().encode("<svg/>") }, "A stick")).rejects.toThrow(/JPEG/);
    await expect(addImage(db, admin, p.id, { name: "a.png", bytes: png }, "")).rejects.toThrow(/shows/);
    await addImage(db, admin, p.id, { name: "front.png", bytes: png }, "The front");
    await addImage(db, admin, p.id, { name: "back.png", bytes: png }, "The back");
    const images = await db.productMedia.findMany({ where: { productId: p.id }, orderBy: { sortOrder: "asc" } });
    expect(images[0]).toMatchObject({ filename: "front.webp", contentType: "image/webp", width: 1600, height: 800 });
    expect((await sharp(Buffer.from(images[0].thumb!)).metadata()).width).toBe(480);
    await moveImageUp(db, admin, images[1].id);
    expect((await db.productMedia.findFirstOrThrow({ where: { productId: p.id }, orderBy: { sortOrder: "asc" } })).alt).toBe("The back");

    await expect(addDatasheet(db, admin, p.id, { name: "x.pdf", bytes: png }, "Spec")).rejects.toThrow(/PDF/);
    await addDatasheet(db, admin, p.id, { name: "spec sheet", bytes: new TextEncoder().encode("%PDF-1.4 test") }, "Spec sheet");
    expect(await db.productMedia.count({ where: { productId: p.id, kind: "DATASHEET", filename: "spec sheet.pdf" } })).toBe(1);
  });

  it("shows media of products outside the shop to staff only", async () => {
    const p = await createProduct(db, admin, productInput(cat.id, { status: "DRAFT" }));
    await addDatasheet(db, admin, p.id, { name: "d.pdf", bytes: new TextEncoder().encode("%PDF-1.4") }, "Draft sheet");
    const m = await db.productMedia.findFirstOrThrow({ where: { productId: p.id } });
    expect(await readMedia(db, m.id, { thumb: false, staff: false })).toBeNull();
    expect(await readMedia(db, m.id, { thumb: false, staff: true })).toMatchObject({ contentType: "application/pdf" });
  });
});

describe.skipIf(!hasDb)("the shop", () => {
  let admin: Staff;
  let laptops: Awaited<ReturnType<typeof category>>;
  let memory: Awaited<ReturnType<typeof category>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = await makeStaff("ADMIN");
    const top = await category(admin, "Shop computers");
    laptops = await category(admin, "Shop laptops", top.id);
    memory = await category(admin, "Shop memory");
    await addSpecField(db, admin, top.id, field("Memory type", "CHOICE", { options: "DDR4\nDDR5", mustMatch: true }));
    await addSpecField(db, admin, laptops.id, field("RAM", "NUMBER", { unit: "GB", highlight: true }));
    await addSpecField(db, admin, laptops.id, field("Touch screen", "YES_NO"));
    await addSpecField(db, admin, memory.id, field("Memory type", "CHOICE", { options: "DDR4\nDDR5", mustMatch: true }));
    await setSuggestions(db, admin, laptops.id, [memory.id]);

    const make = async (key: string, o: Partial<ProductInput>, specs: Record<string, string>) => {
      const p = await createProduct(db, admin, productInput(o.categoryId ?? laptops.id, o));
      await saveSpecs(db, admin, p.id, specs);
      ids[key] = p.id;
    };
    await make("hp", { brand: "HP", name: "ProBook zq9 laptop", mpn: "ZQ9-HP" }, { ram: "16", touch_screen: "yes", memory_type: "DDR5" });
    await make("dell", { brand: "Dell", name: "Latitude zq9 laptop" }, { ram: "8", touch_screen: "no", memory_type: "DDR4" });
    await make("lenovo", { brand: "Lenovo", name: "ThinkPad zq9 laptop" }, { ram: "16", memory_type: "DDR5" });
    await make("draft", { brand: "HP", name: "Draft zq9 laptop", status: "DRAFT" }, { ram: "64" });
    await make("ddr5", { brand: "Kingston", name: "zq9 DDR5 stick", categoryId: memory.id }, { memory_type: "DDR5" });
    await make("ddr4", { brand: "Kingston", name: "zq9 DDR4 stick", categoryId: memory.id }, { memory_type: "DDR4" });

    const supplier = await createSupplier(db, admin, { name: `Secret Supplier ${tag()}`, kind: "LOCAL", country: "BW", currency: "USD", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "5", preferred: false, active: true });
    await saveOffer(db, admin, { supplierId: supplier.id, productId: ids.hp, cost: "987.65", supplierSku: "SECRET-SKU", leadTimeDays: "", moq: "", stock: "", active: true });
  });

  it("lists only active products and filters by specification, counting each facet", async () => {
    const all = (await browse(db, { category: laptops.slug }))!;
    expect(all.total).toBe(3);
    const r = (await browse(db, { category: laptops.slug, values: { ram: ["16"] } }))!;
    expect(r.items.map((i) => i.id).sort()).toEqual([ids.hp, ids.lenovo].sort());
    const ram = r.facets.find((f) => f.field.key === "ram")!;
    // Other values still show what ticking them would add.
    expect(ram.options).toEqual([
      { value: "8", label: "8 GB", count: 1, chosen: false },
      { value: "16", label: "16 GB", count: 2, chosen: true },
    ]);
    expect(r.brands.map((b) => b.label)).toEqual(["HP", "Lenovo"]);
    const touch = (await browse(db, { category: laptops.slug, values: { touch_screen: ["yes"] }, brands: ["hp"] }))!;
    expect(touch.items.map((i) => i.id)).toEqual([ids.hp]);
    expect(touch.items[0].highlights).toEqual(["16 GB"]);
  });

  it("searches by words and part number, and reads filters from the address", async () => {
    const r = (await browse(db, { q: "zq9 thinkpad" }))!;
    expect(r.items.map((i) => i.id)).toEqual([ids.lenovo]);
    const byMpn = (await browse(db, { q: "zq9hp" }))!;
    expect(byMpn.items.map((i) => i.id)).toEqual([ids.hp]);
    expect(browseParamsFrom({ q: "x", b: ["hp", "dell"], "f.ram": "16", "min.ram": "8", "max.ram": "nope", "f.Bad": "1", sort: "name", page: "2" })).toEqual({
      q: "x",
      brands: ["hp", "dell"],
      values: { ram: ["16"] },
      ranges: { ram: { min: 8 } },
      sort: "name",
      page: 2,
    });
    expect(await browse(db, { category: "no-such-category" })).toBeNull();
  });

  it("never shows supplier names, costs or codes", async () => {
    const page = await shopProduct(db, (await db.product.findUniqueOrThrow({ where: { id: ids.hp } })).slug);
    const listing = await browse(db, { q: "zq9" });
    const compared = await compareProducts(db, [ids.hp, ids.dell]);
    const text = JSON.stringify([page, listing, compared], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of ["Secret Supplier", "SECRET-SKU", "98765", "987.65", "costMinor", "offers"]) expect(text).not.toContain(secret);
  });

  it("suggests items whose must-match specifications agree", async () => {
    const hp = await shopProduct(db, (await db.product.findUniqueOrThrow({ where: { id: ids.hp } })).slug);
    expect(hp!.suggested.map((s) => s.id)).toEqual([ids.ddr5]);
    const dell = await shopProduct(db, (await db.product.findUniqueOrThrow({ where: { id: ids.dell } })).slug);
    expect(dell!.suggested.map((s) => s.id)).toEqual([ids.ddr4]);
    await linkProducts(db, admin, ids.dell, (await db.product.findUniqueOrThrow({ where: { id: ids.hp } })).mpn);
    const linked = await shopProduct(db, (await db.product.findUniqueOrThrow({ where: { id: ids.hp } })).slug);
    expect(linked!.goesWith.map((g) => g.id)).toEqual([ids.dell]);
    expect(await shopProduct(db, (await db.product.findUniqueOrThrow({ where: { id: ids.draft } })).slug)).toBeNull();
  });

  it("compares up to four products and marks the rows that differ", async () => {
    const c = await compareProducts(db, [ids.dell, ids.hp, ids.draft]);
    expect(c.products.map((p) => p.id)).toEqual([ids.dell, ids.hp]);
    expect(c.rows.find((r) => r.key === "ram")).toMatchObject({ values: ["8 GB", "16 GB"], differs: true });
    expect(c.rows.find((r) => r.key === "warranty")).toMatchObject({ differs: false });
  });

  it("hides products when their category is switched off", async () => {
    await updateCategory(db, admin, memory.id, { name: memory.name, description: "", parentId: null, sortOrder: 0, active: false, sourcingRule: null });
    expect(await browse(db, { category: memory.slug })).toBeNull();
    expect((await browse(db, { q: "zq9 stick" }))!.total).toBe(0);
    await updateCategory(db, admin, memory.id, { name: memory.name, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null });
  });
});
