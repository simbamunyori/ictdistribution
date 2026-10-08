import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  MoneyParseError,
  add,
  toPlainAmount,
  applyBps,
  divCeil,
  divRound,
  currencyName,
  currencySymbol,
  formatMoney,
  isSupportedCurrency,
  fromJson,
  money,
  parseMoney,
  subtract,
  times,
  toJson,
  total,
} from "./money";

const P = (n: bigint) => money(n, "BWP");

describe("parseMoney", () => {
  it.each([
    ["12400", 1240000n],
    ["12,400", 1240000n],
    ["P 12 400.5", 1240050n],
    ["12400.50", 1240050n],
    ["0.01", 1n],
    ["BWP 171,630.40", 17163040n],
    ["-5", -500n],
    ["7.", 700n],
  ])("reads %s", (input, expected) => {
    expect(parseMoney(input, "BWP")).toBe(expected);
  });

  it.each(["", "abc", "1.234", "12..0", "1e5", "--1"])("rejects %s", (input) => {
    expect(() => parseMoney(input, "BWP")).toThrow(MoneyParseError);
  });

  it("handles amounts beyond float precision", () => {
    expect(parseMoney("90071992547409.93", "BWP")).toBe(9007199254740993n);
  });

  it("reads a decimal comma in locales that use one", () => {
    expect(parseMoney("R 1 234,50", "ZAR", "en-ZA")).toBe(123450n);
    expect(parseMoney("1234.5", "ZAR", "en-ZA")).toBe(123450n);
    expect(parseMoney("US$ 19.99", "USD", "en-ZW")).toBe(1999n);
  });

  it("refuses a currency it doesn't know", () => {
    expect(() => parseMoney("1", "XXX")).toThrow();
  });
});

/** Intl puts no-break spaces around symbols and between groups; compare with plain ones. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/gu, " ");
const fmt = (m: Parameters<typeof formatMoney>[0], locale: string, opts?: Parameters<typeof formatMoney>[2]) => plain(formatMoney(m, locale, opts));

describe("formatMoney", () => {
  it.each([
    ["en-BW", money(20909813n, "BWP"), "P 209,098.13"],
    ["en-BW", money(5n, "BWP"), "P 0.05"],
    ["en-BW", money(0n, "BWP"), "P 0.00"],
    ["en-ZA", money(123456789n, "ZAR"), "R 1 234 567,89"],
    ["en-ZW", money(1999n, "USD"), "US$19.99"],
    ["en-US", money(1999n, "USD"), "$19.99"],
    ["en-ZA", money(1999n, "USD"), "US$19,99"],
    ["en-BW", money(1999n, "USD"), "US$19.99"],
    ["en-US", money(1999n, "BWP"), "BWP 19.99"],
  ])("writes amounts the way %s does", (locale, m, expected) => {
    expect(fmt(m, locale)).toBe(expected);
  });

  it("keeps a currency's own number of decimals", () => {
    expect(fmt(money(1500n, "JPY"), "en-US")).toBe("¥1,500");
  });

  it("formats exact amounts beyond float precision", () => {
    expect(fmt(money(9007199254740993n, "BWP"), "en-BW")).toBe("P 90,071,992,547,409.93");
  });

  it("uses a true minus sign", () => {
    expect(fmt(P(-1240000n), "en-BW")).toBe("−P 12,400.00");
    expect(fmt(money(-1240000n, "ZAR"), "en-ZA")).toBe("−R 12 400,00");
  });

  it("can show a plus sign for credits, and none for zero", () => {
    expect(fmt(P(100n), "en-BW", { signed: true })).toBe("+P 1.00");
    expect(fmt(P(0n), "en-BW", { signed: true })).toBe("P 0.00");
  });

  it("can leave the currency out for dense columns", () => {
    expect(fmt(P(1240000n), "en-BW", { bare: true })).toBe("12,400.00");
    expect(fmt(money(-1999n, "USD"), "en-ZW", { bare: true })).toBe("−19.99");
  });

  it("names and marks currencies from Intl, not a table", () => {
    expect(currencySymbol("ZAR", "en-ZA")).toBe("R");
    expect(currencySymbol("USD", "en-ZW")).toBe("US$");
    expect(currencyName("BWP", "en-BW")).toMatch(/Pula/);
    expect(isSupportedCurrency("ZWG")).toBe(true);
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and multiplies in one currency", () => {
    expect(add(P(150n), P(250n))).toEqual(P(400n));
    expect(subtract(P(150n), P(250n))).toEqual(P(-100n));
    expect(times(P(12345n), 7)).toEqual(P(86415n));
    expect(total([P(1n), P(2n), P(3n)], "BWP")).toEqual(P(6n));
    expect(total([], "BWP")).toEqual(P(0n));
  });

  it("never mixes currencies", () => {
    expect(() => add(P(1n), money(1n, "USD"))).toThrow(CurrencyMismatchError);
    expect(() => total([P(1n), money(1n, "USD")], "BWP")).toThrow(CurrencyMismatchError);
  });

  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divCeil(1n, 100n)).toBe(1n);
    expect(divCeil(100n, 100n)).toBe(1n);
    expect(divCeil(0n, 100n)).toBe(0n);
  });

  it("applies basis points", () => {
    expect(applyBps(10000n, 1500)).toBe(1500n);
    expect(applyBps(333n, 5000)).toBe(167n);
  });

  it("round-trips through JSON without floats", () => {
    const m = P(9007199254740993n);
    expect(fromJson(toJson(m))).toEqual(m);
    expect(() => fromJson({ amountMinor: "1.5", currency: "BWP" })).toThrow();
  });
});

describe("toPlainAmount", () => {
  it("writes an amount the way it is typed, and parses back", () => {
    for (const minor of [0n, 5n, 190000n, 123456789n, -250n]) {
      expect(parseMoney(toPlainAmount(P(minor)), "BWP")).toBe(minor);
    }
    expect(toPlainAmount(P(190000n))).toBe("1900.00");
    expect(toPlainAmount(P(5n))).toBe("0.05");
  });
});
