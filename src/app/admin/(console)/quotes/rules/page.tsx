import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { QuoteRulesForm } from "@/components/admin/quote-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { rulesForm } from "@/server/quotes/staff";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Quote rules" };

export default async function QuoteRules() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewQuotes")) redirect("/admin");
  const { base, values } = await rulesForm(prisma);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/quotes" className="text-link underline underline-offset-4">
          Quotes
        </Link>
      </p>
      <PageHeader title="Quote rules" lead="When a quote goes out without anyone checking it, how long suppliers get to answer, and how long prices hold. Markups otherwise come from the category and the price level." />
      <Card className="max-w-4xl">
        <QuoteRulesForm given={values} base={base} canEdit={staffCan(role, "manageQuoteRules")} />
      </Card>
    </>
  );
}
