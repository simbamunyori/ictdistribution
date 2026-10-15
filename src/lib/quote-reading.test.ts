import { describe, expect, it } from "vitest";
import { guessCategory, partNumbers, readTable, readText, readTextLine, rfqReferenceIn, searchWords } from "./quote-reading";

describe("reading typed lines", () => {
  it("finds the quantity at the start or the end", () => {
    expect(readTextLine("5 x Dell P2425H 24 inch monitor")).toMatchObject({ quantity: 5, description: "Dell P2425H 24 inch monitor", mpn: "P2425H", unclear: null });
    expect(readTextLine("- 12 pcs Cat6 patch cable 2m")).toMatchObject({ quantity: 12, description: "Cat6 patch cable 2m" });
    expect(readTextLine("TP-Link SG2428P switch - 3")).toMatchObject({ quantity: 3, description: "TP-Link SG2428P switch", mpn: "SG2428P" });
    expect(readTextLine("HP ProBook 450 G10 x 20")).toMatchObject({ quantity: 20, description: "HP ProBook 450 G10" });
    expect(readTextLine("Kingston 16GB DDR5 laptop memory 8 units")).toMatchObject({ quantity: 8, description: "Kingston 16GB DDR5 laptop memory" });
  });

  it("doesn't take a size for a quantity, and flags a line without one", () => {
    expect(readTextLine("24 port gigabit switch")).toMatchObject({ quantity: null, unclear: "No quantity given." });
    expect(readTextLine("16 GB DDR5 SO-DIMM")).toMatchObject({ quantity: null });
  });

  it("leaves out greetings and blank lines", () => {
    expect(readText("Hello team,\n\n2 x Lenovo 21M7001\n\nKind regards\nNeo")).toEqual([expect.objectContaining({ quantity: 2, mpn: "21M7001" }), expect.objectContaining({ description: "Neo", quantity: null })]);
  });

  it("knows a part number from a size", () => {
    expect(partNumbers("Dell P2425H 512GB 2.5GHz KVR56S46BS8-16")).toEqual(["P2425H", "KVR56S46BS8-16"]);
  });
});

describe("reading spreadsheets", () => {
  it("finds the heading row and reads the lines under it", () => {
    const table = [["Bill of materials"], [], ["Item", "Part No", "Brand", "Qty"], ["24 port PoE switch", "SG2428P", "TP-Link", 2], ["Patch panel", "", "", "4"], ["", "", "", ""], ["Access point", "EAP650", "TP-Link", "lots"]];
    expect(readTable(table)).toEqual([
      expect.objectContaining({ description: "TP-Link 24 port PoE switch", mpn: "SG2428P", quantity: 2 }),
      expect.objectContaining({ description: "Patch panel", mpn: null, quantity: 4 }),
      expect.objectContaining({ description: "TP-Link Access point", quantity: null, unclear: "No quantity given." }),
    ]);
  });

  it("reads rows as typed lines when there is no heading", () => {
    expect(readTable([["3", "Dell P2425H monitor"]])).toEqual([expect.objectContaining({ quantity: 3, description: "Dell P2425H monitor" })]);
  });
});

describe("guessing a category", () => {
  const categories = [
    { slug: "switches", name: "Switches" },
    { slug: "access-points", name: "Access points" },
    { slug: "memory", name: "Memory" },
    { slug: "laptops", name: "Laptops" },
  ];
  it("matches singular and plural names, the longest first", () => {
    expect(guessCategory("24 port switch", categories)).toBe("switches");
    expect(guessCategory("Wi-Fi 6 access point, ceiling", categories)).toBe("access-points");
    expect(guessCategory("Laptop bag", categories)).toBe("laptops");
    expect(guessCategory("Toner cartridge", categories)).toBeNull();
  });
});

it("keeps the words worth searching for", () => {
  expect(searchWords("The Dell 24 inch monitor, with stand")).toEqual(["dell", "monitor", "stand"]);
});

it("finds an RFQ reference in a reply's subject", () => {
  expect(rfqReferenceIn("Re: Request for price rfq-7k2m9q")).toBe("RFQ-7K2M9Q");
  expect(rfqReferenceIn("Quote please")).toBeNull();
});
