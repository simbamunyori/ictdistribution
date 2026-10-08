import { describe, expect, it } from "vitest";
import { buildStatement } from "./statement";

describe("statements", () => {
  it("puts an invoice before a payment on the same day, even when the payment carries only the date", () => {
    const invoice = { date: new Date("2026-10-08T12:30:00Z"), kind: "invoice" as const, reference: "INV-1", details: "", amountMinor: 1000n };
    const payment = { date: new Date("2026-10-08T00:00:00Z"), kind: "payment" as const, reference: "ORD-1", details: "", amountMinor: 400n };
    const st = buildStatement([payment, invoice], new Date("2026-10-01T00:00:00Z"), new Date("2026-10-09T00:00:00Z"));
    expect(st.entries.map((e) => [e.kind, e.balance])).toEqual([
      ["invoice", 1000n],
      ["payment", 600n],
    ]);
  });
});
