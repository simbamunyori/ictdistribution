import { describe, expect, it } from "vitest";
import { parseRate } from "./pricing";
import { agreedBeforeTax, fromMarket, marginBps, quoteTotals, quoteUnitPrice, reviewReasons, type AutomationRules } from "./quote-pricing";

const bw = { currency: "BWP", fxBufferBps: 200, roundToMinor: 100, taxRateBps: 1400 };
const rate = parseRate("13.65");

describe("quote prices", () => {
  it("adds the markup, converts with the buffer and rounds up, before tax", () => {
    // USD 500.00 + 12% = 560.00; x 13.65 x 1.02 = 7,796.88; up to P 7,797.00.
    expect(quoteUnitPrice({ amountMinor: 500_00n, currency: "USD" }, 1200, bw, rate)).toEqual({ amountMinor: 7_797_00n, currency: "BWP" });
  });

  it("adds tax on the total", () => {
    expect(quoteTotals([7_797_00n, 2_000_00n], 1400)).toEqual({ subtotal: 9_797_00n, tax: 1_371_58n, total: 11_168_58n });
  });

  it("takes the tax out of an agreed price", () => {
    expect(agreedBeforeTax(1_140_00n, 1400)).toBe(1_000_00n);
  });

  it("checks the margin in the base currency, never overstating revenue", () => {
    const revenue = fromMarket({ amountMinor: 7_797_00n, currency: "BWP" }, "USD", rate);
    expect(revenue.amountMinor).toBe(571_20n);
    expect(marginBps(revenue.amountMinor, 500_00n)).toBe(1246);
    expect(marginBps(0n, 1n)).toBeNull();
  });
});

describe("automation rules", () => {
  const rules: AutomationRules = { automationEnabled: true, maxAutoValueMinor: 5_000_00n, minMarginBps: 800, minMatchConfidence: 90 };
  const line = { position: 1, description: "Dell P2425H", productId: "p1", matchConfidence: 100, flagReason: null, unitPriceMinor: 100n };
  const quote = { lines: [line], subtotalBase: 1_000_00n, marginBps: 1200, knownCustomer: true, maxValueText: "US$5,000.00", minMarginText: "8%" };

  it("sends a quote inside every rule", () => {
    expect(reviewReasons(rules, quote)).toEqual([]);
  });

  it("says why anything else needs a person", () => {
    const reasons = reviewReasons(
      { ...rules, automationEnabled: false },
      {
        ...quote,
        lines: [line, { ...line, position: 2, flagReason: "No quantity given." }, { ...line, position: 3, unitPriceMinor: null }, { ...line, position: 4, productId: null }, { ...line, position: 5, matchConfidence: 70 }],
        subtotalBase: 6_000_00n,
        marginBps: 500,
        knownCustomer: false,
      },
    );
    expect(reasons).toEqual([
      "Automatic sending is switched off.",
      "Line 2, Dell P2425H: No quantity given.",
      "Line 3, Dell P2425H: no price yet.",
      "Line 4, Dell P2425H: not a product we list.",
      "Line 5, Dell P2425H: the match to our product needs checking.",
      "It is above US$5,000.00, the most that goes out by itself.",
      "Its margin is below 8%.",
      "It came from someone without an account.",
    ]);
  });
});
