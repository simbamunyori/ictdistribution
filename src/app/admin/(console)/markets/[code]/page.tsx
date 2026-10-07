import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { collectionPointActiveAction } from "@/app/admin/(console)/shop-actions";
import { MarketForm } from "@/components/admin/forms";
import { CollectionPointForm, MarketDeliveryForm, MarketTaxForm } from "@/components/admin/shop-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { toPlainAmount } from "@/lib/money";
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
  const canSell = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const points = await prisma.collectionPoint.findMany({ where: { marketCode: market.code }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  const plain = (amountMinor: bigint) => toPlainAmount({ amountMinor, currency: market.currency });
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

      <h2 id="selling" className="mt-10 mb-4 text-title font-bold">
        Selling in {market.name}
      </h2>
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <h3 className="mb-1 text-headline font-bold">Tax and bank details</h3>
          <p className="mb-4 text-callout text-ink-muted">Admins only. Shop prices include this tax, and orders by bank transfer show these details.</p>
          <MarketTaxForm code={market.code} readOnly={!canEdit} values={{ taxName: market.taxName, taxPercent: String(market.taxRateBps / 100), bankDetails: market.bankDetails }} />
        </Card>
        <Card>
          <h3 className="mb-4 text-headline font-bold">Delivery</h3>
          <MarketDeliveryForm
            code={market.code}
            currency={market.currency}
            readOnly={!canSell}
            values={{ deliveryEnabled: market.deliveryEnabled, deliveryFee: plain(market.deliveryFeeMinor), freeDeliveryFrom: market.freeDeliveryMinor !== null ? plain(market.freeDeliveryMinor) : "", deliveryNote: market.deliveryNote }}
          />
        </Card>
        <Card>
          <h3 className="mb-4 text-headline font-bold">Collection points</h3>
          {points.length ? (
            <ul className="mb-6 flex flex-col divide-y divide-line rounded-md border border-line">
              {points.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {p.name} {p.active ? null : <Badge>Closed</Badge>}
                    </span>
                    <span className="block text-callout whitespace-pre-line text-ink-muted">{[p.address, p.hours].filter(Boolean).join("\n")}</span>
                  </span>
                  {canSell ? <ActionForm action={collectionPointActiveAction} hidden={{ id: p.id, code: market.code, active: p.active ? "0" : "1" }} label={p.active ? "Close" : "Open"} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-6 text-ink-muted">None yet. Customers can only choose delivery.</p>
          )}
          {canSell ? <CollectionPointForm code={market.code} /> : null}
        </Card>
      </div>
    </>
  );
}
