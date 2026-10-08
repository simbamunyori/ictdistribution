import { describe, expect, it } from "vitest";
import { money } from "./money";
import { convert, customerPrice, movedBps, parseRate, rateText, roundUpTo, withMarkup } from "./pricing";

const bw = { currency: "BWP", fxBufferBps: 0, roundToMinor: 0 };

describe("rates", () => {
  it("reads decimal text exactly", () => {
    expect(parseRate("13.6512")).toEqual({ num: 136512n, den: 10000n });
    expect(parseRate("1")).toEqual({ num: 1n, den: 1n });
  });

  it("refuses what isn't a positive rate", () => {
    for (const bad of ["0", "-1", "1e3", "abc", "", "1.1234567890123"]) expect(() => parseRate(bad)).toThrow();
  });

  it("writes feed numbers as plain decimals", () => {
    expect(rateText(13.6512)).toBe("13.6512");
    expect(rateText(1)).toBe("1");
    expect(() => rateText(0)).toThrow();
    expect(() => rateText(Number.NaN)).toThrow();
  });

  it("measures how far a rate moved", () => {
    expect(movedBps(parseRate("10"), parseRate("11"))).toBe(1000);
    expect(movedBps(parseRate("10"), parseRate("9.5"))).toBe(500);
    expect(movedBps(parseRate("18.20"), parseRate("18.20"))).toBe(0);
  });
});

describe("prices", () => {
  it("adds the markup", () => {
    expect(withMarkup(100_00n, 2500)).toBe(125_00n);
    expect(withMarkup(99n, 1500)).toBe(114n);
    expect(() => withMarkup(1n, -1)).toThrow();
  });

  it("rounds up to the market's step", () => {
    expect(roundUpTo(1_234_01n, 100)).toBe(1_235_00n);
    expect(roundUpTo(1_234_00n, 100)).toBe(1_234_00n);
    expect(roundUpTo(1_234_01n, 0)).toBe(1_234_01n);
  });

  it("converts through the rate and buffer, rounding up, without floats", () => {
    // USD 1,000.00 at 13.6512 is BWP 13,651.20; a 2% buffer makes it 13,924.224, so 13,924.23.
    expect(convert(money(1_000_00n, "USD"), { ...bw, fxBufferBps: 200 }, parseRate("13.6512"))).toEqual(money(13_924_23n, "BWP"));
    // Then to the next whole pula.
    expect(convert(money(1_000_00n, "USD"), { ...bw, fxBufferBps: 200, roundToMinor: 100 }, parseRate("13.6512"))).toEqual(money(13_925_00n, "BWP"));
  });

  it("needs no rate in the same currency", () => {
    expect(convert(money(499_99n, "USD"), { currency: "USD", fxBufferBps: 300, roundToMinor: 100 }, null)).toEqual(money(500_00n, "USD"));
    expect(() => convert(money(1n, "USD"), bw, null)).toThrow(/No exchange rate/);
  });

  it("handles currencies with no minor unit", () => {
    expect(convert(money(10_00n, "USD"), { currency: "JPY", fxBufferBps: 0, roundToMinor: 0 }, parseRate("149.5"))).toEqual(money(1495n, "JPY"));
  });

  it("prices for a customer: markup, then conversion", () => {
    expect(customerPrice(money(800_00n, "USD"), 2500, { currency: "ZAR", fxBufferBps: 0, roundToMinor: 100 }, parseRate("18.2"))).toEqual(money(18_200_00n, "ZAR"));
  });
});
