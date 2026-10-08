import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { accountCodeFrom, netLines, xeroCsv } from "../src/lib/accounting-export";
import { inBase } from "../src/lib/reports";
import { applyForCredit, decideCredit } from "../src/server/accounts/credit";
import { addDocument, approveOrganisation, saveBusinessDetails, submitForCheck } from "../src/server/accounts/verification";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { exportData, exportFile } from "../src/server/finance/export";
import { openInvoices, reminderDue, sendReminderNow, sendReminders } from "../src/server/finance/reminders";
import { financeReport } from "../src/server/finance/reports";
import { financeSettings, setAccountCode, updateFinanceSettings, type FinanceSettingsInput } from "../src/server/finance/settings";
import { invoiceByToken } from "../src/server/portal/invoices";
import type { PortalViewer } from "../src/server/portal/scope";
import { pricingSettings, setRate } from "../src/server/pricing/rates";
import { addToCart, cartFor } from "../src/server/shop/cart";
import { fulfilOrder, placeOrder, recordPayment, type CheckoutInput } from "../src/server/shop/orders";
import { priceContext } from "../src/server/shop/prices";
import { updateMarketDelivery, updateMarketTaxAndBank } from "../src/server/shop/settings";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, lastSecret, makeOrganisation, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toUpperCase();
const DAY = 86_400_000;
const amount = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

describe("the reminder schedule", () => {
  const s = { firstReminderDays: 3, reminderEveryDays: 7, maxReminders: 2 };
  const now = new Date("2026-05-20T08:00:00Z");
  it("waits for the first, spaces the rest and stops at the most", () => {
    expect(reminderDue({ daysOverdue: 2, remindersSent: 0, lastReminderAt: null }, s, now)).toBe(false);
    expect(reminderDue({ daysOverdue: 3, remindersSent: 0, lastReminderAt: null }, s, now)).toBe(true);
    expect(
      reminderDue(
        {
          daysOverdue: 9,
          remindersSent: 1,
          lastReminderAt: new Date(now.getTime() - 6 * DAY),
        },
        s,
        now,
      ),
    ).toBe(false);
    // An hour early still counts, so a daily job does not slip a day.
    expect(
      reminderDue(
        {
          daysOverdue: 10,
          remindersSent: 1,
          lastReminderAt: new Date(now.getTime() - 7 * DAY + 30 * 60_000),
        },
        s,
        now,
      ),
    ).toBe(true);
    expect(
      reminderDue(
        {
          daysOverdue: 30,
          remindersSent: 2,
          lastReminderAt: new Date(now.getTime() - 20 * DAY),
        },
        s,
        now,
      ),
    ).toBe(false);
    // Zero days still waits until the day after it was due.
    expect(reminderDue({ daysOverdue: 0, remindersSent: 0, lastReminderAt: null }, { ...s, firstReminderDays: 0 }, now)).toBe(false);
  });
});

describe.skipIf(!hasDb)("finance", () => {
  let admin: Awaited<ReturnType<typeof makeStaff>>;
  let categoryId: string;
  let supplier: { id: string; name: string };
  const settings = (over: Partial<FinanceSettingsInput> = {}): FinanceSettingsInput => ({
    remindersOn: true,
    firstReminderDays: "3",
    reminderEveryDays: "7",
    maxReminders: "2",
    salesAccountCode: "4000",
    taxCode: "T1",
    zeroTaxCode: "T0",
    cashAccountCode: "CASHSALE",
    bankAccountCode: "1200",
    ...over,
  });

  async function product() {
    const mpn = `FN${tag()}`;
    const p = await createProduct(db, admin, {
      name: `Switch ${mpn}`,
      brand: "MikroTik",
      mpn,
      categoryId,
      summary: "",
      description: "",
      warrantyMonths: "12",
      warrantyTerms: "",
      sellToIndividuals: true,
      status: "ACTIVE",
      sourcingRule: null,
    });
    await saveOffer(db, admin, {
      supplierId: supplier.id,
      productId: p.id,
      cost: "100.00",
      supplierSku: "",
      leadTimeDays: "",
      moq: "",
      stock: "",
      active: true,
    });
    return p;
  }

  const PDF = {
    name: "certificate.pdf",
    bytes: new Uint8Array(Buffer.from("%PDF-1.4\n% test document\n")),
  };

  async function business() {
    const name = `Kgale Data ${tag()}`;
    const org = await makeOrganisation(name);
    await saveBusinessDetails(db, org.owner, {
      name,
      registrationNumber: "BW00001234567",
      taxNumber: "C01234567890",
      address: "Plot 9, Kgale",
      directors: "Neo Kgosi",
    });
    await addDocument(db, org.owner, "REGISTRATION", PDF);
    await addDocument(db, org.owner, "TAX", PDF);
    await submitForCheck(db, org.owner, {});
    await approveOrganisation(db, admin, { key: KEY }, org.organisationId);
    await applyForCredit(db, org.owner, {
      limit: "100000",
      termsDays: "30",
      details: "We spend about P20,000 a month with two trade references.",
    });
    const app = await db.creditApplication.findFirstOrThrow({
      where: { organisationId: org.organisationId, status: "PENDING" },
    });
    await decideCredit(db, admin, { key: KEY }, app.id, {
      approve: true,
      limit: "100000",
      termsDays: "30",
      note: "",
    });
    const owner: PortalViewer = {
      userId: org.owner.userId,
      name: org.owner.name,
      email: org.email,
      organisationId: org.organisationId,
      role: "OWNER",
    };
    return { org, owner, name };
  }

  const checkout = (): CheckoutInput => ({
    email: `fn-${tag().toLowerCase()}@example.co.bw`,
    name: "Neo Kgosi",
    phone: "+267 71 234 567",
    fulfilment: "DELIVERY",
    addressLine1: "Plot 9",
    addressLine2: "",
    city: "Gaborone",
    postalCode: "",
    collectionPointId: "",
    paymentMethod: "ACCOUNT",
    notes: "",
    customerReference: "PO-12",
  });

  /** A business order on account, sent, so it has its invoice due in 30 days. */
  async function invoiced(quantity = 3) {
    const b = await business();
    const p = await product();
    const cart = await cartFor(db, undefined);
    await addToCart(db, cart.id, { productId: p.id }, quantity, {
      trade: true,
    });
    const ctx = await priceContext(db, await db.market.findUniqueOrThrow({ where: { code: "bw" } }), "BUSINESS", new Date(), b.owner.organisationId);
    const { order } = await placeOrder(
      db,
      { key: KEY },
      cart.id,
      ctx,
      {
        userId: b.owner.userId,
        organisationId: b.owner.organisationId,
        role: b.owner.role,
      },
      checkout(),
    );
    await fulfilOrder(db, admin, { key: KEY }, order.id, "");
    const invoice = await db.invoice.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    return { ...b, order, invoice };
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await makeStaff("ADMIN");
    await setRate(db, admin, "BWP", "13.65");
    await updateMarketTaxAndBank(db, admin, "bw", {
      taxName: "VAT",
      taxPercent: "14",
      bankDetails: "Test Bank\nAccount 123",
      taxNumber: "P03000000000",
    });
    await updateMarketDelivery(db, admin, "bw", {
      deliveryEnabled: true,
      deliveryFee: "80",
      freeDeliveryFrom: "100000",
      deliveryNote: "",
    });
    categoryId = (
      await createCategory(db, admin, {
        name: `Finance kit ${tag()}`,
        description: "",
        parentId: null,
        sortOrder: 0,
        active: true,
        sourcingRule: null,
      })
    ).id;
    const name = `Finance supplier ${tag()}`;
    supplier = {
      id: (
        await createSupplier(db, admin, {
          name,
          kind: "LOCAL",
          country: "BW",
          currency: "BWP",
          email: "",
          whatsapp: "",
          phone: "",
          website: "",
          portalUrl: "",
          notes: "",
          leadTimeDays: "3",
          minOrder: "",
          landedCostPercent: "0",
          preferred: false,
          active: true,
        })
      ).id,
      name,
    };
    await updateFinanceSettings(db, admin, settings());
  });

  it("checks the finance settings and who may change them", async () => {
    await expect(updateFinanceSettings(db, await makeStaff("SALES"), settings())).rejects.toThrow(/role/);
    await expect(updateFinanceSettings(db, admin, settings({ maxReminders: "0", taxCode: "has space" }))).rejects.toMatchObject({
      fieldErrors: {
        maxReminders: expect.any(String),
        taxCode: expect.any(String),
      },
    });
    expect(await financeSettings(db)).toMatchObject({
      maxReminders: 2,
      updatedByLabel: admin.name,
    });
  });

  it("chases an overdue invoice on the schedule, with a link that opens it, and stops once paid", async () => {
    const { order, invoice } = await invoiced();
    const due = invoice.dueAt.getTime();
    const mine = async () => db.invoiceReminder.count({ where: { invoiceId: invoice.id } });

    await sendReminders(db, { key: KEY }, new Date(due + 2 * DAY));
    expect(await mine()).toBe(0);
    await sendReminders(db, { key: KEY }, new Date(due + 3 * DAY));
    expect(await mine()).toBe(1);
    const { token } = await lastSecret(order.email, "invoice.reminder");
    expect((await invoiceByToken(db, invoice.number, token))?.id).toBe(invoice.id);
    expect(await invoiceByToken(db, "INV-1", token)).toBeNull();
    // Running twice the same day sends nothing more.
    await sendReminders(db, { key: KEY }, new Date(due + 3 * DAY + 60_000));
    expect(await mine()).toBe(1);
    await sendReminders(db, { key: KEY }, new Date(due + 10 * DAY));
    expect(await mine()).toBe(2);
    // Two is the most set.
    await sendReminders(db, { key: KEY }, new Date(due + 30 * DAY));
    expect(await mine()).toBe(2);
    const open = (await openInvoices(db, new Date(due + 30 * DAY))).find((i) => i.id === invoice.id);
    expect(open).toMatchObject({
      outstandingMinor: order.totalMinor,
      remindersSent: 2,
      band: "d1_30",
    });

    // Finance can send one by hand, but not twice in an hour, and not once paid.
    await expect(sendReminderNow(db, await makeStaff("SALES"), { key: KEY }, invoice.id)).rejects.toThrow(/role/);
    const finance = await makeStaff("FINANCE");
    const later = new Date(due + 31 * DAY);
    expect(await sendReminderNow(db, finance, { key: KEY }, invoice.id, null, later)).toBe(invoice.number);
    await expect(sendReminderNow(db, finance, { key: KEY }, invoice.id, null, new Date(later.getTime() + 60_000))).rejects.toThrow(/last hour/);
    await recordPayment(db, admin, { key: KEY }, order.id, {
      amount: amount(order.totalMinor),
      reference: "EFT 9",
      receivedOn: today(),
    });
    expect((await openInvoices(db)).some((i) => i.id === invoice.id)).toBe(false);
    await expect(sendReminderNow(db, finance, { key: KEY }, invoice.id, null, new Date(later.getTime() + 2 * 3_600_000))).rejects.toThrow(/paid/);
  });

  it("sends nothing while reminders are off", async () => {
    const { invoice } = await invoiced(1);
    await updateFinanceSettings(db, admin, settings({ remindersOn: false }));
    try {
      expect(await sendReminders(db, { key: KEY }, new Date(invoice.dueAt.getTime() + 5 * DAY))).toBe(0);
      expect(await db.invoiceReminder.count({ where: { invoiceId: invoice.id } })).toBe(0);
    } finally {
      await updateFinanceSettings(db, admin, settings());
    }
  });

  it("exports invoices under the customer's account code, with net and tax adding up", async () => {
    const { org, name, order, invoice } = await invoiced(2);
    const from = new Date(invoice.issuedAt.getTime() - 60_000);
    const to = new Date(invoice.issuedAt.getTime() + 60_000);
    let doc = (await exportData(db, from, to)).docs.find((d) => d.number === invoice.number)!;
    expect(doc).toMatchObject({
      kind: "invoice",
      accountCode: accountCodeFrom(name),
      customerName: name,
      reference: order.number,
      totalMinor: invoice.totalMinor,
    });
    const nets = netLines(doc);
    expect(nets.reduce((s, l) => s + l.netMinor + l.taxMinor, 0n)).toBe(invoice.totalMinor);
    expect(nets.reduce((s, l) => s + l.taxMinor, 0n)).toBe(invoice.taxMinor);

    await setAccountCode(db, admin, org.organisationId, ` kgale${tag()} `);
    const other = await business();
    const code = (
      await db.organisation.findUniqueOrThrow({
        where: { id: org.organisationId },
      })
    ).accountCode;
    expect(code).toMatch(/^KGALE/);
    await expect(setAccountCode(db, admin, other.org.organisationId, code)).rejects.toMatchObject({ field: "accountCode" });
    await expect(setAccountCode(db, await makeStaff("SALES"), org.organisationId, "X1")).rejects.toThrow(/role/);
    const data = await exportData(db, from, to);
    doc = data.docs.find((d) => d.number === invoice.number)!;
    expect(doc.accountCode).toBe(code);
    expect(xeroCsv([doc], data.codes, "Africa/Gaborone")).toContain(invoice.number);

    const finance = await makeStaff("FINANCE");
    const file = await exportFile(db, finance, "sage", from, to, {
      fromDay: "2026-01-01",
      toDay: "2026-01-31",
    });
    expect(file.filename).toBe("sage-2026-01-01-to-2026-01-31.csv");
    expect(file.csv).toContain(`SI,${code},4000`);
    expect(
      await db.auditEvent.count({
        where: { action: "finance.export", actorUserId: finance.userId },
      }),
    ).toBe(1);
    await expect(
      exportFile(db, await makeStaff("SALES"), "xero", from, to, {
        fromDay: "a",
        toDay: "b",
      }),
    ).rejects.toThrow(/role/);
  });

  it("reports sales and landed-cost margin by market, category, supplier and customer type", async () => {
    const { order, name } = await invoiced(4);
    // As an order from a quote records it; shop orders get theirs from the purchase order.
    await db.orderLine.updateMany({
      where: { orderId: order.id },
      data: { supplierId: supplier.id },
    });
    const base = (await pricingSettings(db)).baseCurrency;
    // Just this order's moment, so orders from other tests stay out.
    const r = await financeReport(db, order.createdAt, order.createdAt);
    const row = r.byOrder.find((o) => o.id === order.id)!;
    expect(row.sales).toBe(
      inBase(order.totalMinor - order.taxMinor, "BWP", base, {
        num: 1365n,
        den: 100n,
      }),
    );
    expect(row.costed).toBe(true);
    expect(row.marginBps).toBeGreaterThan(0);
    const cat = r.byCategory.find((c) => c.label.startsWith("Finance kit"));
    expect(cat).toMatchObject({ orders: 1 });
    expect(r.bySupplier.find((s) => s.label === supplier.name)).toMatchObject({
      orders: 1,
      cost: row.cost,
    });
    expect(r.topCustomers.find((c) => c.label === name)).toMatchObject({
      sales: row.sales,
    });
    expect(r.byCustomerType.map((t) => t.label)).toContain("Business");
    expect(r.byMarket.find((m) => m.label === "Botswana")?.orders).toBeGreaterThanOrEqual(1);
    expect(r.total.sales).toBe(r.byMarket.reduce((s, m) => s + m.sales, 0n));
    expect(r.open.map((o) => o.status)).toEqual(["AWAITING_PAYMENT", "PAID", "ON_ACCOUNT"]);
  });
});
