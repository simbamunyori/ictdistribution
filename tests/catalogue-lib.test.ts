import { describe, expect, it } from "vitest";
import { formatSpec, mpnKey, parseSpecValue, readCompare, searchTerms, searchTextFor, slugify, specKey } from "../src/lib/catalogue";
import { guessColumns, missingColumns, parseCsv, priceMoveBps, readCost, readLines } from "../src/lib/price-list";
import { parseRate, toBase } from "../src/lib/pricing";
import { chooseOffer, resolveRule, type OfferForChoice } from "../src/lib/sourcing";

describe("catalogue helpers", () => {
  it("makes addresses and keys", () => {
    expect(slugify("Wi-Fi extenders")).toBe("wi-fi-extenders");
    expect(slugify("  Cables & adapters ")).toBe("cables-and-adapters");
    expect(slugify("Écrans 27\"")).toBe("ecrans-27");
    expect(specKey("Memory (GB)")).toBe("memory_gb");
    expect(specKey("4G support")).toBe("f_4g_support");
  });

  it("matches part numbers however they are written", () => {
    expect(mpnKey("5cd-123.45")).toBe(mpnKey("5CD12345"));
    expect(mpnKey(" ab/12_3 ")).toBe("AB123");
  });

  it("reads specification values by kind", () => {
    expect(parseSpecValue({ kind: "NUMBER", options: [], label: "RAM" }, "1,024")).toEqual({ value: 1024 });
    expect(parseSpecValue({ kind: "NUMBER", options: [], label: "RAM" }, "lots").error).toMatch(/number/);
    expect(parseSpecValue({ kind: "YES_NO", options: [], label: "PoE" }, "Yes")).toEqual({ value: true });
    expect(parseSpecValue({ kind: "YES_NO", options: [], label: "PoE" }, "maybe").error).toMatch(/yes or no/);
    expect(parseSpecValue({ kind: "CHOICE", options: ["DDR4", "DDR5"], label: "Type" }, "ddr5")).toEqual({ value: "DDR5" });
    expect(parseSpecValue({ kind: "CHOICE", options: ["DDR4", "DDR5"], label: "Type" }, "DDR3").error).toMatch(/one of/);
    expect(parseSpecValue({ kind: "TEXT", options: [], label: "Colour" }, "  ")).toEqual({});
    expect(formatSpec({ kind: "NUMBER", unit: "GB" }, 16)).toBe("16 GB");
    expect(formatSpec({ kind: "YES_NO", unit: "" }, false)).toBe("No");
  });

  it("builds search text and words", () => {
    const t = searchTextFor({ name: "EliteBook 840", brand: "HP", mpn: "5C-D12", category: "Laptops", specs: { ram: 16, poe: true, cpu: "Core i7" } });
    expect(t).toContain("elitebook 840 hp 5c-d12 5cd12 laptops");
    expect(t).toContain("core i7");
    expect(t).not.toContain("true");
    expect(searchTerms("  HP, hp  i7 a (840)")).toEqual(["hp", "i7", "840"]);
  });

  it("keeps at most four valid ids for compare", () => {
    const ids = ["a", "b", "c", "d", "e"].map((x) => x.repeat(25));
    expect(readCompare([...ids, ids[0], "bad;id"].join(","))).toEqual(ids.slice(0, 4));
    expect(readCompare(undefined)).toEqual([]);
  });
});

describe("price lists", () => {
  it("reads CSV with commas, semicolons, tabs and quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n\n1,2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
    expect(parseCsv("mpn;cost\nAB1;14 200,00")).toEqual([["mpn", "cost"], ["AB1", "14 200,00"]]);
    expect(parseCsv("﻿mpn\tcost\nX\t1")).toEqual([["mpn", "cost"], ["X", "1"]]);
  });

  it("reads costs in the forms suppliers send", () => {
    expect(readCost("14 200,00", "ZAR")).toBe(1_420_000n);
    expect(readCost("R 1,234.50", "ZAR")).toBe(123_450n);
    expect(readCost("1.234,5", "ZAR")).toBe(123_450n);
    expect(readCost("1,234", "USD")).toBe(123_400n);
    expect(readCost(99.999, "USD")).toBe(10_000n);
    expect(() => readCost("", "USD")).toThrow();
    expect(() => readCost(-1, "USD")).toThrow();
  });

  it("guesses columns and says which are missing", () => {
    const headers = ["Stock Code", "Part Number", "Description", "Brand", "Dealer Price", "Qty", "MOQ"];
    const map = guessColumns(headers);
    expect(map).toMatchObject({ supplierSku: "Stock Code", mpn: "Part Number", name: "Description", brand: "Brand", cost: "Dealer Price", stock: "Qty", moq: "MOQ" });
    expect(missingColumns(map, headers)).toEqual([]);
    expect(missingColumns({ mpn: "Part Number" }, headers)).toEqual(["cost"]);
    expect(missingColumns({ mpn: "Gone", cost: "Dealer Price" }, headers)).toEqual(["mpn"]);
  });

  it("turns rows into lines and keeps errors per line", () => {
    const table = [["Title row"], ["MPN", "Price", "Stock", "Cur"], ["ab-1", "10.00", "5", ""], ["", "3", "", ""], ["CD2", "free", "x", "XYZ"], [null, null, null, null], ["EF3", 0, "", "usd"]];
    const { headers, lines } = readLines(table, { mpn: "MPN", cost: "Price", stock: "Stock", currency: "Cur" }, { headerRow: 2, currency: "ZAR" });
    expect(headers).toEqual(["MPN", "Price", "Stock", "Cur"]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ line: 3, mpnKey: "AB1", costMinor: 1000n, stock: 5, currency: "ZAR" });
    expect(lines[0].error).toBeUndefined();
    expect(lines[1].error).toMatch(/No part number/);
    expect(lines[2].error).toMatch(/Unknown currency XYZ.*can't be read.*Stock/);
    expect(lines[3]).toMatchObject({ currency: "USD", error: "Cost is zero" });
  });

  it("measures price moves", () => {
    expect(priceMoveBps(10_000n, 11_000n)).toBe(1000);
    expect(priceMoveBps(10_000n, 9_000n)).toBe(1000);
    expect(priceMoveBps(0n, 5n)).toBe(0);
  });
});

describe("choosing a supplier", () => {
  const rate = parseRate("18.20");
  const rates = (c: string) => (c === "ZAR" ? rate : null);
  const offer = (id: string, o: Partial<Omit<OfferForChoice, "supplier">> & { supplier?: Partial<OfferForChoice["supplier"]> } = {}): OfferForChoice => ({
    id,
    costMinor: 10_000n,
    currency: "USD",
    leadTimeDays: null,
    stock: null,
    active: true,
    ...o,
    supplier: { id: `s-${id}`, name: id, active: true, preferred: false, leadTimeDays: 7, landedCostBps: 0, ...o.supplier },
  });

  it("converts to the base currency, rounding up", () => {
    expect(toBase({ amountMinor: 1_417_500n, currency: "ZAR" }, "USD", rate)).toEqual({ amountMinor: 77_885n, currency: "USD" });
    expect(() => toBase({ amountMinor: 1n, currency: "ZAR" }, "USD", null)).toThrow(/rate/);
  });

  it("picks the cheapest landed cost, counting freight and the rate", () => {
    const local = offer("local", { costMinor: 1_350_000n, currency: "ZAR", supplier: { landedCostBps: 500 } });
    const china = offer("china", { costMinor: 70_000n, supplier: { landedCostBps: 1800, leadTimeDays: 21 } });
    const c = chooseOffer([china, local], "CHEAPEST_LANDED", "USD", rates);
    expect(c.chosen?.offer.id).toBe("local");
    expect(c.chosen?.landed?.amountMinor).toBe(77_885n);
    expect(c.ranked[1].landed?.amountMinor).toBe(82_600n);
    expect(chooseOffer([china, local], "FASTEST", "USD", rates).chosen?.offer.id).toBe("local");
  });

  it("follows the rule chosen", () => {
    const cheapSlow = offer("cheap", { costMinor: 9_000n, leadTimeDays: 30 });
    const fastDear = offer("fast", { costMinor: 12_000n, leadTimeDays: 2 });
    const preferred = offer("pref", { costMinor: 15_000n, supplier: { preferred: true } });
    expect(chooseOffer([cheapSlow, fastDear, preferred], "CHEAPEST_LANDED", "USD", rates).chosen?.offer.id).toBe("cheap");
    expect(chooseOffer([cheapSlow, fastDear, preferred], "FASTEST", "USD", rates).chosen?.offer.id).toBe("fast");
    expect(chooseOffer([cheapSlow, fastDear, preferred], "PREFERRED", "USD", rates).chosen?.offer.id).toBe("pref");
  });

  it("puts out-of-stock and unusable offers last", () => {
    const none = offer("none", { costMinor: 5_000n, stock: 0 });
    const ok = offer("ok", { costMinor: 8_000n });
    const off = offer("off", { costMinor: 1n, supplier: { active: false } });
    const norate = offer("norate", { costMinor: 1n, currency: "BWP" });
    const c = chooseOffer([off, norate, none, ok], "CHEAPEST_LANDED", "USD", rates);
    expect(c.ranked.map((r) => r.offer.id)).toEqual(["ok", "none", "off", "norate"]);
    expect(c.ranked[2].unavailable).toBe("Supplier switched off");
    expect(c.ranked[3].unavailable).toMatch(/BWP/);
    expect(chooseOffer([off], "FASTEST", "USD", rates).chosen).toBeNull();
  });

  it("takes the most specific rule", () => {
    expect(resolveRule(null, "FASTEST", "PREFERRED")).toBe("FASTEST");
    expect(resolveRule(undefined, null)).toBe("CHEAPEST_LANDED");
  });
});
