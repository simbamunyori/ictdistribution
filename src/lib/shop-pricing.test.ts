import { describe, expect, it } from "vitest";
import { bestSpecial, deliveryFee, discounted, priceUnder, shelfPrice, taxIncluded, timeLeft } from "./shop-pricing";

const bw = { currency: "BWP", fxBufferBps: 200, roundToMinor: 100, taxRateBps: 1400 };
const rate = { num: 1365n, den: 100n }; // 13.65 BWP per USD

describe("shop prices", () => {
  it("adds markup and tax, converts and rounds up to the market's step", () => {
    // 500.00 landed, +20% = 600.00, +14% = 684.00 USD; x 13.65 x 1.02 = 9523.43 BWP, up to 9524.00.
    expect(shelfPrice({ amountMinor: 500_00n, currency: "USD" }, 2000, bw, rate)).toEqual({ amountMinor: 9524_00n, currency: "BWP" });
  });

  it("finds the tax inside a price that includes it", () => {
    expect(taxIncluded(1140_00n, 1400)).toBe(140_00n);
    expect(taxIncluded(1000_00n, 0)).toBe(0n);
  });

  it("takes a percentage off and rounds up", () => {
    expect(discounted(9524_00n, 1000, 100)).toBe(8572_00n);
  });

  it("ignores a fixed special price above the usual one", () => {
    expect(priceUnder({ discountBps: null, priceMinor: 9999_00n }, 9524_00n, 100)).toBeNull();
    expect(priceUnder({ discountBps: null, priceMinor: 8999_00n }, 9524_00n, 100)).toBe(8999_00n);
  });

  it("picks the lowest special that still has units", () => {
    const a = { id: "a", discountBps: 500, priceMinor: null, remaining: null };
    const b = { id: "b", discountBps: null, priceMinor: 8000_00n, remaining: 0 };
    const c = { id: "c", discountBps: 1000, priceMinor: null, remaining: 3 };
    expect(bestSpecial([a, b, c], 9524_00n, 100)).toEqual({ special: c, price: 8572_00n });
    expect(bestSpecial([], 9524_00n, 100)).toBeNull();
  });

  it("charges delivery below the free threshold only", () => {
    const m = { deliveryEnabled: true, deliveryFeeMinor: 80_00n, freeDeliveryMinor: 5000_00n };
    expect(deliveryFee(4999_00n, m)).toBe(80_00n);
    expect(deliveryFee(5000_00n, m)).toBe(0n);
    expect(deliveryFee(100_00n, { ...m, deliveryEnabled: false })).toBeNull();
  });

  it("words the time left", () => {
    const now = new Date("2026-10-07T08:00:00Z");
    const at = (min: number) => new Date(now.getTime() + min * 60_000);
    expect(timeLeft(at(3 * 1440 + 5), now)).toBe("Ends in 3 days");
    expect(timeLeft(at(1440 + 125), now)).toBe("Ends in 1 day 2 h");
    expect(timeLeft(at(200), now)).toBe("Ends in 3 h 20 min");
    expect(timeLeft(at(0.2), now)).toBe("Ends in 1 min");
    expect(timeLeft(at(-1), now)).toBe("Ended");
  });
});
