import { beforeEach, describe, expect, it } from "vitest";
import { formatMoney, money } from "../src/lib/money";
import { customerPrice } from "../src/lib/pricing";
import { createMarket, updateMarket } from "../src/server/markets/markets";
import { updateCustomerType } from "../src/server/pricing/customer-types";
import { acceptRate, asRate, currentRate, rateWarnings, refreshRates, setRate, type FetchedRates, type RateSource } from "../src/server/pricing/rates";
import { db, hasDb, makeStaff } from "./helpers";

class FakeSource implements RateSource {
  constructor(public next: FetchedRates | Error) {}
  async latest(): Promise<FetchedRates> {
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
const rates = (BWP: number, ZAR: number, at = new Date()): FetchedRates => ({ publishedAt: at, rates: { BWP, ZAR, USD: 1 }, source: "open.er-api.com" });

describe.skipIf(!hasDb)("exchange rates", () => {
  beforeEach(async () => {
    await db.exchangeRate.deleteMany();
    await db.pricingSettings.update({ where: { id: "global" }, data: { ratesError: null, rateJumpHoldBps: 1000 } });
  });

  it("stores rates for every currency in use, and skips repeats", async () => {
    const at = new Date(Date.now() - 3_600_000);
    const first = await refreshRates(db, new FakeSource(rates(13.6512, 18.2)));
    expect(first.stored.sort()).toEqual(["BWP", "ZAR"]);
    expect((await currentRate(db, "USD", "BWP"))?.rate).toBe("13.6512");
    await refreshRates(db, new FakeSource(rates(13.7, 18.3, at)));
    const again = await refreshRates(db, new FakeSource(rates(13.7, 18.3, at)));
    expect(again.unchanged.sort()).toEqual(["BWP", "ZAR"]);
  });

  it("holds back a big jump until Admin or Finance accepts it", async () => {
    await refreshRates(db, new FakeSource(rates(13.65, 18.2)));
    const result = await refreshRates(db, new FakeSource(rates(16.5, 18.25)));
    expect(result.held).toEqual(["BWP"]);
    expect(result.stored).toEqual(["ZAR"]);
    expect((await currentRate(db, "USD", "BWP"))?.rate).toBe("13.65");
    expect((await rateWarnings(db)).join(" ")).toMatch(/held back/);

    const held = await db.exchangeRate.findFirstOrThrow({ where: { heldBack: { not: null } } });
    await expect(acceptRate(db, await makeStaff("SALES"), held.id)).rejects.toThrow(/role/);
    await acceptRate(db, await makeStaff("FINANCE"), held.id);
    expect((await currentRate(db, "USD", "BWP"))?.rate).toBe("16.5");
  });

  it("keeps the rates in use and records why when the source fails", async () => {
    await refreshRates(db, new FakeSource(rates(13.65, 18.2)));
    await expect(refreshRates(db, new FakeSource(new Error("The rate source answered 503.")))).rejects.toThrow();
    await expect(refreshRates(db, new FakeSource({ ...rates(13.65, 18.2), rates: { BWP: 13.65 } }))).rejects.toThrow(/ZAR/);
    expect((await currentRate(db, "USD", "BWP"))?.rate).toBe("13.65");
    expect((await rateWarnings(db)).join(" ")).toMatch(/fetch failed/);
  });

  it("takes a rate typed by staff, checked", async () => {
    const admin = await makeStaff("ADMIN");
    await expect(setRate(db, admin, "BWP", "thirteen")).rejects.toThrow(/number/);
    await setRate(db, admin, "BWP", "13.80");
    expect((await currentRate(db, "USD", "BWP"))?.source).toBe("staff");
  });

  it("prices in each market's currency with markup, buffer and rounding", async () => {
    await refreshRates(db, new FakeSource(rates(13.6512, 18.2)));
    const bw = await db.market.findUniqueOrThrow({ where: { code: "bw" } });
    const zw = await db.market.findUniqueOrThrow({ where: { code: "zw" } });
    const cost = money(100_000n, "USD");
    const reseller = await db.customerType.findUniqueOrThrow({ where: { code: "RESELLER" } });
    const inPula = customerPrice(cost, reseller.markupBps, bw, asRate(await currentRate(db, "USD", "BWP")));
    expect(inPula.currency).toBe("BWP");
    expect(inPula.amountMinor % 100n).toBe(0n);
    expect(formatMoney(customerPrice(cost, reseller.markupBps, zw, null), zw.locale)).toMatch(/1,120\.00/);
  });
});

describe.skipIf(!hasDb)("markets and price levels", () => {
  it("lets only an Admin change price levels, and logs it", async () => {
    await expect(updateCustomerType(db, await makeStaff("SALES"), "BUSINESS", { name: "Business", description: "", markupPercent: 10, guestCheckout: false })).rejects.toThrow(/role/);
    const admin = await makeStaff("ADMIN");
    await expect(updateCustomerType(db, admin, "BUSINESS", { name: "Business", description: "", markupPercent: 900, guestCheckout: false })).rejects.toThrow();
    const t = await updateCustomerType(db, admin, "BUSINESS", { name: "Business", description: "Registered companies.", markupPercent: 17.5, guestCheckout: true });
    expect(t.markupBps).toBe(1750);
    expect(t.guestCheckout).toBe(false);
    expect(await db.auditEvent.count({ where: { action: "customer-type.updated", actorUserId: admin.userId } })).toBe(1);
  });

  it("adds a market and keeps exactly one default", async () => {
    const admin = await makeStaff("ADMIN");
    const input = { name: "Namibia", currency: "ZAR", locale: "en-NA", timeZone: "Africa/Windhoek", fxBufferPercent: "2", roundToMinor: "100", supportEmail: "", sortOrder: "40", enabled: false, isDefault: false };
    const na = await createMarket(db, admin, "NA", input);
    expect(na.code).toBe("na");
    await expect(createMarket(db, admin, "NA", input)).rejects.toThrow(/already/);
    await expect(updateMarket(db, admin, "na", { ...input, isDefault: true })).rejects.toThrow(/switched on/);
    await updateMarket(db, admin, "na", { ...input, enabled: true, isDefault: true });
    expect((await db.market.findMany({ where: { isDefault: true } })).map((m) => m.code)).toEqual(["na"]);
    await expect(updateMarket(db, admin, "na", { ...input, enabled: true, isDefault: false })).rejects.toThrow(/default/);
    await updateMarket(db, admin, "bw", { name: "Botswana", currency: "BWP", locale: "en-BW", timeZone: "Africa/Gaborone", fxBufferPercent: "2", roundToMinor: "100", supportEmail: "", sortOrder: "10", enabled: true, isDefault: true });
    expect((await db.market.findMany({ where: { isDefault: true } })).map((m) => m.code)).toEqual(["bw"]);
  });
});
