import { describe, expect, it } from "vitest";
import { alternatives, cleanCopy, needTerms, readNeed } from "./assistant";
import { breadcrumbJsonLd, jsonLdText, metaDescription, productJsonLd } from "./seo";

describe("reading a need", () => {
  it("finds the budget, how many and the words to search for", () => {
    expect(readNeed("Laptops for a 20-person office within P12,000 each")).toEqual({ terms: ["laptops"], maxPrice: 12000, quantity: 20 });
    expect(readNeed("a 24 port PoE switch under $800")).toMatchObject({ maxPrice: 800, terms: ["port", "poe", "switch"] });
    expect(readNeed("budget of 5k for a monitor")).toMatchObject({ maxPrice: 5000, terms: ["monitor"] });
    expect(readNeed("UPS for 12 users")).toMatchObject({ maxPrice: null, quantity: 12, terms: ["ups"] });
    expect(readNeed("5 notebooks for the sales team")).toMatchObject({ quantity: 5, terms: expect.arrayContaining(["notebooks"]) });
    expect(readNeed("hello")).toMatchObject({ terms: ["hello"], maxPrice: null, quantity: null });
  });

  it("drops filler and numbers from search words", () => {
    expect(needTerms("Can you recommend the best printer for our office please")).toEqual(["printer"]);
  });

  it("knows other words for the same thing", () => {
    expect(alternatives("laptop")).toEqual(["laptop", "laptops", "notebook", "notebooks"]);
    expect(alternatives("Wifi")).toContain("access point");
    expect(alternatives("thinkpad")).toEqual(["thinkpad"]);
  });

  it("keeps the assistant's words to our copy rules", () => {
    expect(cleanCopy("Great choice\u0021 This one \u2014 the 14 inch \u2013 fits.")).toBe("Great choice. This one, the 14 inch, fits.");
  });
});

describe("structured data for search engines", () => {
  const base = { name: "ThinkPad E14", brand: "Lenovo", mpn: "21JK0000", description: "A 14 inch business laptop.", url: "https://ictdistribution.africa/products/lenovo-thinkpad-e14", images: ["https://ictdistribution.africa/media/1"], category: "Computers > Laptops", leadTimeDays: 5, warrantyMonths: 12 };

  it("describes a product with its retail offer", () => {
    const ld = productJsonLd({ ...base, price: { amountMinor: 1_249_900n, currency: "BWP" } });
    expect(ld).toMatchObject({ "@type": "Product", name: "Lenovo ThinkPad E14", mpn: "21JK0000", brand: { name: "Lenovo" }, offers: { price: "12499.00", priceCurrency: "BWP", availability: "https://schema.org/BackOrder" } });
    expect(productJsonLd({ ...base, price: null })).not.toHaveProperty("offers");
  });

  it("numbers breadcrumbs and keeps script text safe", () => {
    expect(breadcrumbJsonLd([{ name: "Products", url: "u1" }, { name: "Laptops", url: "u2" }])).toMatchObject({ itemListElement: [{ position: 1 }, { position: 2, name: "Laptops" }] });
    expect(jsonLdText({ d: "</script><script>" })).not.toContain("</script>");
  });

  it("cuts descriptions at a word", () => {
    const d = metaDescription("word ".repeat(60));
    expect(d.length).toBeLessThanOrEqual(163);
    expect(d.endsWith("word...")).toBe(true);
    expect(metaDescription("  Short   text ")).toBe("Short text");
  });
});
