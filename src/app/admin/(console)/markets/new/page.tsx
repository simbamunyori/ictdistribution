import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketForm } from "@/components/admin/forms";
import { Card, PageHeader } from "@/components/ui/card";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { countryOptions } from "@/lib/countries";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Add a market" };

export default async function NewMarket() {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageMarkets")) redirect("/admin/markets");
  const [currencies, taken] = await Promise.all([listCurrencies(prisma), prisma.market.findMany({ select: { country: true } })]);
  const used = new Set(taken.map((m) => m.country));
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/markets" className="text-link underline underline-offset-4">
          Markets
        </Link>
      </p>
      <PageHeader title="Add a market" lead="It starts closed, so you can check prices before customers see it. Add its currency first if it isn't in the list." />
      <Card className="max-w-3xl">
        <MarketForm
          readOnly={false}
          countries={countryOptions().filter((c) => !used.has(c.value))}
          currencies={currencies.filter((c) => c.enabled).map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` }))}
          market={{ name: "", currency: "USD", locale: "en", timeZone: DEFAULT_TIME_ZONE, fxBufferPercent: "2", roundToMinor: "100", supportEmail: "", sortOrder: "100", enabled: false, isDefault: false }}
        />
      </Card>
    </>
  );
}
