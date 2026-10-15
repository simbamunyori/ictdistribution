import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { updateFinanceSettingsAction } from "@/app/admin/(console)/finance-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { Card, PageHeader } from "@/components/ui/card";
import { company, DEFAULT_TIME_ZONE } from "@/config/app";
import { formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { financeSettingsForm } from "@/server/finance/settings";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Finance settings" };

export default async function FinanceSettings() {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageFinance")) redirect("/admin");
  const v = await financeSettingsForm(prisma);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/finance" className="text-link underline underline-offset-4">
          Finance
        </Link>
      </p>
      <PageHeader title="Finance settings" lead={`When overdue invoices are chased, and the codes the accounting export uses.${v.updatedByLabel ? ` Last changed by ${v.updatedByLabel}, ${formatDateTime(v.updatedAt, company.staffLocale, DEFAULT_TIME_ZONE)}.` : ""}`} />
      <Card className="max-w-4xl">
        <SpecForm
          action={updateFinanceSettingsAction}
          columns={3}
          fields={[
            {
              kind: "checkbox",
              id: "remindersOn",
              label: "Email customers when an invoice is overdue",
              defaultChecked: v.remindersOn,
              hint: "Each reminder has a fresh link to the invoice. Finance can also send one by hand from the Finance page.",
            },
            {
              kind: "text",
              id: "firstReminderDays",
              label: "First reminder, days after the due date",
              inputMode: "numeric",
              defaultValue: v.firstReminderDays,
            },
            {
              kind: "text",
              id: "reminderEveryDays",
              label: "Then every this many days",
              inputMode: "numeric",
              defaultValue: v.reminderEveryDays,
            },
            {
              kind: "text",
              id: "maxReminders",
              label: "Most reminders per invoice",
              inputMode: "numeric",
              defaultValue: v.maxReminders,
            },
            {
              kind: "text",
              id: "salesAccountCode",
              label: "Sales account code",
              defaultValue: v.salesAccountCode,
              hint: "The income account in the chart of accounts.",
            },
            {
              kind: "text",
              id: "bankAccountCode",
              label: "Bank account code",
              defaultValue: v.bankAccountCode,
              hint: "Where Sage receipts go.",
            },
            {
              kind: "text",
              id: "cashAccountCode",
              label: "Customer account for individuals",
              defaultValue: v.cashAccountCode,
              hint: "Business customers go under their own account code.",
            },
            {
              kind: "text",
              id: "taxCode",
              label: "Tax code for taxed sales",
              defaultValue: v.taxCode,
              hint: "Such as T1 in Sage, or OUTPUT in Xero.",
            },
            {
              kind: "text",
              id: "zeroTaxCode",
              label: "Tax code for zero-rated sales",
              defaultValue: v.zeroTaxCode,
            },
          ]}
          submitLabel="Save settings"
          pendingLabel="Saving"
        />
      </Card>
    </>
  );
}
