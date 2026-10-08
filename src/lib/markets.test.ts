import { describe, expect, it } from "vitest";
import { chooseMarket, defaultMarket, marketForCountry } from "./markets";

const markets = [
  { code: "bw", country: "BW", enabled: true, isDefault: true },
  { code: "za", country: "ZA", enabled: true, isDefault: false },
  { code: "zw", country: "ZW", enabled: true, isDefault: false },
  { code: "na", country: "NA", enabled: false, isDefault: false },
];

describe("markets", () => {
  it("finds an enabled market by country", () => {
    expect(marketForCountry("za", markets)?.code).toBe("za");
    expect(marketForCountry("NA", markets)).toBeNull();
    expect(marketForCountry("KE", markets)).toBeNull();
  });

  it("falls back to the default, or the first enabled", () => {
    expect(defaultMarket(markets).code).toBe("bw");
    expect(defaultMarket(markets.map((m) => ({ ...m, isDefault: false }))).code).toBe("bw");
    expect(() => defaultMarket(markets.map((m) => ({ ...m, enabled: false })))).toThrow();
  });

  it("prefers the account, then the visitor's choice, then their country", () => {
    expect(chooseMarket(markets, { account: "zw", cookie: "za", country: "BW" })).toEqual({ market: markets[2], reason: "account" });
    expect(chooseMarket(markets, { cookie: "za", country: "ZW" })).toEqual({ market: markets[1], reason: "cookie" });
    expect(chooseMarket(markets, { cookie: "na", country: "ZW" })).toEqual({ market: markets[2], reason: "country" });
    expect(chooseMarket(markets, { country: "KE" })).toEqual({ market: markets[0], reason: "default" });
  });
});
