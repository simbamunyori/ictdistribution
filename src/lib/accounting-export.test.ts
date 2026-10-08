import { describe, expect, it } from "vitest";
import { accountCodeFrom, ddmmyyyy, decimal, netLines, paymentsCsv, quickbooksCsv, sageCsv, share, toCsv, xeroCsv, type ExportDoc, type ExportPayment } from "./accounting-export";
import { ageBand, average, daysOverdue, inBase, marginBps, median, rateAt, rateBook } from "./reports";
import { parseRate } from "./pricing";

const codes = {
  salesAccountCode: "4000",
  taxCode: "T1",
  zeroTaxCode: "T0",
  bankAccountCode: "1200",
};
const tz = "Africa/Gaborone";

const invoice: ExportDoc = {
  kind: "invoice",
  number: "INV-100001",
  date: new Date("2026-03-01T10:00:00Z"),
  dueDate: new Date("2026-03-31T10:00:00Z"),
  customerName: "Kalahari Networks",
  accountCode: "KALAHARI",
  email: "buyer@example.com",
  reference: "ICT-100001",
  currency: "BWP",
  pricesIncludeTax: true,
  taxRateBps: 1400,
  // 3 x 100.00 and 1 x 14.00 with 14% tax included in the 314.00.
  lines: [
    { description: "Switch", quantity: 3, amountMinor: 30000n },
    { description: "Delivery", quantity: 1, amountMinor: 1400n },
  ],
  totalMinor: 31400n,
  taxMinor: 3856n,
};

describe("sharing out tax", () => {
  it("shares exactly, the remainder to the largest parts", () => {
    expect(share(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
    expect(share(3856n, [30000n, 1400n])).toEqual([3684n, 172n]);
    expect(share(5n, [0n, 0n])).toEqual([5n, 0n]);
    for (const [t, w] of [
      [101n, [3n, 7n, 11n]],
      [0n, [5n, 5n]],
      [999n, [1n, 998n]],
    ] as [bigint, bigint[]][])
      expect(share(t, w).reduce((a, b) => a + b, 0n)).toBe(t);
  });

  it("nets each line so net and tax come to the total", () => {
    const lines = netLines(invoice);
    expect(lines.map((l) => l.netMinor + l.taxMinor).reduce((a, b) => a + b, 0n)).toBe(invoice.totalMinor);
    expect(lines.reduce((s, l) => s + l.taxMinor, 0n)).toBe(invoice.taxMinor);
    const before = netLines({
      ...invoice,
      pricesIncludeTax: false,
      taxMinor: 4396n,
    });
    expect(before.map((l) => l.netMinor)).toEqual([30000n, 1400n]);
  });
});

describe("formats", () => {
  it("writes decimals and dates as the packages read them", () => {
    expect(decimal(-125050n, "BWP")).toBe("-1250.50");
    expect(decimal(5n, "USD")).toBe("0.05");
    expect(decimal(1200n, "JPY")).toBe("1200");
    expect(ddmmyyyy(new Date("2026-03-31T23:30:00Z"), tz)).toBe("01/04/2026");
  });

  it("quotes cells and makes formulas plain text", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["=SUM(A1)", 'He said "hi", twice'],
          ["-12.50", "+27 11"],
        ],
      ),
    ).toBe(`a,b\r\n'=SUM(A1),"He said ""hi"", twice"\r\n-12.50,'+27 11\r\n`);
  });

  it("makes account codes from names", () => {
    expect(accountCodeFrom("Kalahari Networks (Pty) Ltd")).toBe("KALAHARI");
    expect(accountCodeFrom("Café 9")).toBe("CAFE9");
    expect(accountCodeFrom("***")).toBe("CUSTOMER");
  });
});

describe("files", () => {
  const credit: ExportDoc = {
    ...invoice,
    kind: "credit",
    number: "CN-100001",
    lines: [{ description: "Switch", quantity: 1, amountMinor: 10000n }],
    totalMinor: 10000n,
    taxMinor: 1228n,
  };
  const payments: ExportPayment[] = [
    {
      kind: "payment",
      date: new Date("2026-03-05T09:00:00Z"),
      orderNumber: "ICT-100001",
      invoiceNumber: "INV-100001",
      customerName: "Kalahari Networks",
      accountCode: "KALAHARI",
      reference: "EFT 77",
      method: "Bank transfer",
      currency: "BWP",
      amountMinor: 31400n,
    },
    {
      kind: "refund",
      date: new Date("2026-03-20T09:00:00Z"),
      orderNumber: "ICT-100001",
      invoiceNumber: "INV-100001",
      customerName: "Kalahari Networks",
      accountCode: "KALAHARI",
      reference: "R1",
      method: "Refund",
      currency: "BWP",
      amountMinor: 10000n,
    },
  ];

  it("Xero: a line per item, credits below zero", () => {
    const rows = xeroCsv([invoice, credit], codes, tz).trim().split("\r\n");
    expect(rows[0]).toContain("*ContactName");
    expect(rows[1]).toBe("Kalahari Networks,buyer@example.com,INV-100001,ICT-100001,01/03/2026,31/03/2026,Switch,3,87.72,4000,T1,36.84,BWP");
    expect(rows[3]).toContain("CN-100001");
    expect(rows[3]).toContain(",-87.72,");
  });

  it("QuickBooks: amounts before tax add up", () => {
    const rows = quickbooksCsv([invoice], codes, tz).trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("Order ICT-100001");
    expect(rows[1]).toContain(",263.16,T1,36.84,BWP");
  });

  it("Sage: invoices, credits and receipts, no refunds", () => {
    const rows = sageCsv([invoice, credit], payments, codes, tz).trim().split("\r\n");
    expect(rows.slice(1).map((r) => r.split(",")[0])).toEqual(["SI", "SI", "SC", "SR"]);
    expect(rows[4]).toBe("SR,KALAHARI,1200,,05/03/2026,INV-100001,Payment EFT 77,314.00,T9,0.00,,ICT-100001");
  });

  it("payments: refunds below zero", () => {
    const rows = paymentsCsv(payments, tz).trim().split("\r\n");
    expect(rows[2]).toContain("Refund");
    expect(rows[2]).toContain(",-100.00,BWP");
  });
});

describe("report sums", () => {
  const book = rateBook([
    { quote: "BWP", rate: "13.5", fetchedAt: new Date("2026-02-01") },
    { quote: "BWP", rate: "14", fetchedAt: new Date("2026-03-01") },
  ]);

  it("uses the rate in use on the day", () => {
    expect(rateAt(book, "BWP", new Date("2026-01-01"))).toEqual(parseRate("13.5"));
    expect(rateAt(book, "BWP", new Date("2026-02-15"))).toEqual(parseRate("13.5"));
    expect(rateAt(book, "BWP", new Date("2026-03-02"))).toEqual(parseRate("14"));
    expect(rateAt(book, "ZAR", new Date())).toBeNull();
  });

  it("converts to the base currency", () => {
    expect(inBase(1400n, "BWP", "USD", parseRate("14"))).toBe(100n);
    expect(inBase(1400n, "USD", "USD", null)).toBe(1400n);
    expect(inBase(1400n, "BWP", "USD", null)).toBeNull();
  });

  it("works out margin, middles and age bands", () => {
    expect(marginBps(1000n, 750n)).toBe(2500);
    expect(marginBps(0n, 10n)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(average([])).toBeNull();
    expect(ageBand(0)).toBe("current");
    expect(ageBand(31)).toBe("d31_60");
    expect(ageBand(91)).toBe("d90");
    expect(daysOverdue(new Date("2026-03-01T00:00:00Z"), new Date("2026-03-03T01:00:00Z"))).toBe(2);
  });
});
