import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketForm } from "@/components/admin/forms";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Market" };

export default async function MarketPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const market = await prisma.market.findUnique({ where: { code } });
  if (!market) notFound();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageMarkets");
  const currencies = (await listCurrencies(prisma)).filter((c) => c.enabled || c.code === market.currency).map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` }));
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/markets" className="text-link underline underline-offset-4">
          Markets
        </Link>
      </p>
      <PageHeader title={market.name} lead={`Country code ${market.country}. Every change here is in the audit log.`} />
      {q.created ? (
        <Alert tone="positive" className="mb-6">
          Added. Customers can choose it once it is open and has an exchange rate.
        </Alert>
      ) : null}
      <Card className="max-w-3xl">
        <MarketForm
          readOnly={!canEdit}
          currencies={currencies}
          market={{
            code: market.code,
            name: market.name,
            currency: market.currency,
            locale: market.locale,
            timeZone: market.timeZone,
            fxBufferPercent: (market.fxBufferBps / 100).toString(),
            roundToMinor: market.roundToMinor.toString(),
            supportEmail: market.supportEmail ?? "",
            sortOrder: market.sortOrder.toString(),
            enabled: market.enabled,
            isDefault: market.isDefault,
          }}
        />
      </Card>
    </>
  );
}
