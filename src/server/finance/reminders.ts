import { Prisma, type PrismaClient } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { ageBand, daysOverdue, type AgeBand } from "@/lib/reports";
import { formatDate } from "@/lib/zoned";
import { audit, SYSTEM_ACTOR, staffAudit } from "@/server/audit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { financeSettings } from "./settings";

/**
 * Receivables and overdue reminders. An invoice is open while its order
 * owes anything after credit notes and payments net of refunds. Once it
 * is past its due date by the days set in the finance settings, the daily
 * job emails the customer a reminder with a fresh link to the invoice, and
 * again every so many days up to the most set. Finance can send one at
 * any time from /admin/finance.
 */

type Tx = Prisma.TransactionClient;

export interface OpenInvoice {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  currency: string;
  totalMinor: bigint;
  outstandingMinor: bigint;
  issuedAt: Date;
  dueAt: Date;
  daysOverdue: number;
  band: AgeBand;
  customer: string;
  organisationId: string | null;
  email: string;
  remindersSent: number;
  lastReminderAt: Date | null;
}

/** Every invoice still owing something, oldest due first. */
export async function openInvoices(db: Pick<PrismaClient, "$queryRaw"> | Tx, now = new Date(), only: { organisationId?: string; invoiceId?: string } = {}): Promise<OpenInvoice[]> {
  const rows = await db.$queryRaw<
    {
      id: string;
      number: string;
      orderId: string;
      orderNumber: string;
      currency: string;
      totalMinor: bigint;
      outstanding: bigint;
      issuedAt: Date;
      dueAt: Date;
      customer: string;
      organisationId: string | null;
      email: string;
      sent: bigint;
      lastAt: Date | null;
    }[]
  >`
    SELECT i.id, i.number, i."orderId", o.number AS "orderNumber", i.currency, i."totalMinor", i."issuedAt", i."dueAt", o.email, i."organisationId",
      COALESCE(g.name, o.name) AS customer,
      (i."totalMinor" - COALESCE(c.credited, 0) - COALESCE(p.paid, 0) + COALESCE(r.refunded, 0))::bigint AS outstanding,
      COALESCE(m.sent, 0)::bigint AS sent, m."lastAt"
    FROM "Invoice" i
    JOIN "Order" o ON o.id = i."orderId"
    LEFT JOIN "Organisation" g ON g.id = i."organisationId"
    LEFT JOIN (SELECT "orderId", SUM("amountMinor")::bigint AS paid FROM "OrderPayment" GROUP BY "orderId") p ON p."orderId" = o.id
    LEFT JOIN (SELECT "orderId", SUM("totalMinor")::bigint AS credited FROM "CreditNote" GROUP BY "orderId") c ON c."orderId" = o.id
    LEFT JOIN (SELECT "orderId", SUM("amountMinor")::bigint AS refunded FROM "OrderRefund" GROUP BY "orderId") r ON r."orderId" = o.id
    LEFT JOIN (SELECT "invoiceId", COUNT(*) AS sent, MAX("sentAt") AS "lastAt" FROM "InvoiceReminder" GROUP BY "invoiceId") m ON m."invoiceId" = i.id
    WHERE o.status <> 'CANCELLED'
      AND (i."totalMinor" - COALESCE(c.credited, 0) - COALESCE(p.paid, 0) + COALESCE(r.refunded, 0)) > 0
      ${only.organisationId ? Prisma.sql`AND i."organisationId" = ${only.organisationId}` : Prisma.empty}
      ${only.invoiceId ? Prisma.sql`AND i.id = ${only.invoiceId}` : Prisma.empty}
    ORDER BY i."dueAt" ASC, i.number ASC
    LIMIT 2000`;
  return rows.map((r) => {
    const days = daysOverdue(r.dueAt, now);
    return {
      id: r.id,
      number: r.number,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      currency: r.currency,
      totalMinor: r.totalMinor,
      outstandingMinor: r.outstanding,
      issuedAt: r.issuedAt,
      dueAt: r.dueAt,
      daysOverdue: days,
      band: ageBand(days),
      customer: r.customer,
      organisationId: r.organisationId,
      email: r.email,
      remindersSent: Number(r.sent),
      lastReminderAt: r.lastAt,
    };
  });
}

/** Whether the schedule calls for a reminder about this invoice now. */
export function reminderDue(
  inv: Pick<OpenInvoice, "daysOverdue" | "remindersSent" | "lastReminderAt">,
  s: {
    firstReminderDays: number;
    reminderEveryDays: number;
    maxReminders: number;
  },
  now: Date,
): boolean {
  if (inv.daysOverdue < Math.max(1, s.firstReminderDays)) return false;
  if (inv.remindersSent >= s.maxReminders) return false;
  return !inv.lastReminderAt || now.getTime() - inv.lastReminderAt.getTime() >= s.reminderEveryDays * 86_400_000 - 3_600_000;
}

/** Inside a transaction: records the next reminder for an open invoice and queues its email. */
async function remind(tx: Tx, key: string, inv: OpenInvoice, by: { label: string; actor?: StaffActor; ip?: string | null }, now: Date) {
  const o = await tx.invoice.findUniqueOrThrow({
    where: { id: inv.id },
    select: {
      userId: true,
      organisationId: true,
      order: {
        select: {
          number: true,
          name: true,
          email: true,
          bankDetails: true,
          market: { select: { locale: true, timeZone: true } },
        },
      },
    },
  });
  const token = newToken();
  const sequence = inv.remindersSent + 1;
  await tx.invoiceReminder.create({
    data: {
      invoiceId: inv.id,
      sequence,
      outstandingMinor: inv.outstandingMinor,
      accessTokenHash: hashToken(token),
      sentByLabel: by.label,
      sentAt: now,
    },
  });
  const { locale, timeZone } = o.order.market;
  const money = formatMoney({ amountMinor: inv.outstandingMinor, currency: inv.currency }, locale);
  await queueEmail(tx, key, {
    to: o.order.email,
    kind: "invoice.reminder",
    payload: {
      number: inv.number,
      order: o.order.number,
      name: o.order.name,
      outstanding: money,
      due: formatDate(inv.dueAt, locale, timeZone),
      overdue: inv.daysOverdue > 0 ? "yes" : "",
      bankDetails: o.order.bankDetails,
    },
    secret: { token },
  });
  const summary = `Reminder ${sequence} sent for invoice ${inv.number}, ${money} outstanding`;
  const common = {
    action: "invoice.reminder",
    summary,
    organisationId: o.organisationId,
    subjectUserId: o.userId,
    targetType: "Invoice",
    targetId: inv.id,
    visibleToCustomer: Boolean(o.userId || o.organisationId),
  };
  await audit(tx, by.actor ? staffAudit(by.actor, { ...common, ipAddress: by.ip }) : { ...SYSTEM_ACTOR, ...common });
}

const isDuplicate = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The daily job: a reminder for each overdue invoice the schedule says is due one. Returns how many were sent. */
export async function sendReminders(db: PrismaClient, deps: { key: string }, now = new Date()): Promise<number> {
  const s = await financeSettings(db);
  if (!s.remindersOn) return 0;
  const due = (await openInvoices(db, now)).filter((i) => reminderDue(i, s, now));
  let sent = 0;
  for (const inv of due) {
    try {
      await db.$transaction(async (tx) => {
        // Read again inside the transaction: a payment may have just come in.
        const [fresh] = await openInvoices(tx, now, { invoiceId: inv.id });
        if (!fresh || !reminderDue(fresh, s, now)) return;
        await remind(tx, deps.key, fresh, { label: "Reminder schedule" }, now);
        sent += 1;
      });
    } catch (e) {
      // Another run sent this one first.
      if (!isDuplicate(e)) throw e;
    }
  }
  return sent;
}

/** Finance sends a reminder now, whatever the schedule says, for an invoice that still owes something. */
export async function sendReminderNow(db: PrismaClient, actor: StaffActor, deps: { key: string }, invoiceId: string, ip?: string | null, now = new Date()): Promise<string> {
  assertStaffCan(actor, "manageFinance");
  try {
    return await db.$transaction(async (tx) => {
      const [inv] = await openInvoices(tx, now, { invoiceId });
      if (!inv) throw new DomainError("conflict", "This invoice is paid, so there is nothing to chase.");
      if (inv.lastReminderAt && now.getTime() - inv.lastReminderAt.getTime() < 60 * 60_000) throw new DomainError("conflict", `A reminder for ${inv.number} went in the last hour.`);
      await remind(tx, deps.key, inv, { label: actor.name, actor, ip }, now);
      return inv.number;
    });
  } catch (e) {
    if (isDuplicate(e)) throw new DomainError("conflict", "A reminder for this invoice was just sent.");
    throw e;
  }
}

/** Reminders sent for an invoice, newest first, for the staff order page. */
export async function remindersFor(db: Pick<PrismaClient, "invoiceReminder">, invoiceId: string) {
  return db.invoiceReminder.findMany({
    where: { invoiceId },
    orderBy: { sentAt: "desc" },
    select: {
      sequence: true,
      outstandingMinor: true,
      sentAt: true,
      sentByLabel: true,
    },
  });
}
