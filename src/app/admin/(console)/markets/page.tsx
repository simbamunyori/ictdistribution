import type { Metadata } from "next";
import Link from "next/link";
import { currencyEnabledAction } from "@/app/admin/(console)/actions";
import { AddCurrencyForm } from "@/components/admin/forms";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatMoney, money } from "@/lib/money";
import { customerPrice } from "@/lib/pricing";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCurrencies, listMarkets } from "@/server/markets/markets";
import { listCustomerTypes } from "@/server/pricing/customer-types";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Markets" };

/** The example cost in the preview: 1,000.00 in the base currency. */
const EXAMPLE_MINOR = 100_000n;

export default async function Markets() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageMarkets");
  const [markets, currencies, types, settings] = await Promise.all([listMarkets(prisma), listCurrencies(prisma), listCustomerTypes(prisma), pricingSettings(prisma)]);
  const base = settings.baseCurrency;
  const rates = await currentRates(prisma, base);
  const cost = money(EXAMPLE_MINOR, base);

  return (
    <>
      <PageHeader
        title="Markets"
        lead="The countries we sell in. Customers see prices in their market's currency, converted at the current rate plus the market's buffer, then rounded up."
        actions={
          canEdit ? (
            <Link href="/admin/markets/new" className={buttonClass("primary")}>
              Add a market
            </Link>
          ) : null
        }
      />
      <Card className="mb-6">
        <TableWrap label="Markets">
          <table className="w-full min-w-[42rem] text-callout">
            <thead>
              <tr>
                <th className={th}>Market</th>
                <th className={th}>Currency</th>
                <th className={th}>Buffer</th>
                <th className={th}>Rounding</th>
                <th className={th}>Status</th>
                <th className={th}>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.code}>
                  <td className={cn(td, "font-semibold text-ink")}>
                    {m.name} <span className="font-normal text-ink-muted uppercase">{m.code}</span>
                  </td>
                  <td className={td}>{m.currency}</td>
                  <td className={cn(td, "tabular-nums")}>{(m.fxBufferBps / 100).toFixed(2)}%</td>
                  <td className={cn(td, "tabular-nums")}>{m.roundToMinor <= 1 ? "None" : `Up to ${formatMoney(money(BigInt(m.roundToMinor), m.currency), m.locale)}`}</td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1">
                      {m.enabled ? <Badge tone="positive">Open</Badge> : <Badge>Closed</Badge>}
                      {m.isDefault ? <Badge tone="highlight">Default</Badge> : null}
                    </span>
                  </td>
                  <td className={cn(td, "text-right")}>
                    <Link href={`/admin/markets/${m.code}`} className="font-semibold text-link underline underline-offset-4">
                      {canEdit ? "Edit" : "View"}
                      <span className="sr-only"> {m.name}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card className="mb-6">
        <h2 className="text-headline font-bold">What a {formatMoney(cost, "en")} cost sells for</h2>
        <p className="mt-1 text-callout text-ink-muted">With today&apos;s rates, each market&apos;s buffer and rounding, and each price level&apos;s markup. Before VAT.</p>
        <TableWrap label="Prices by market and price level">
          <table className="mt-3 w-full min-w-[36rem] text-callout">
            <thead>
              <tr>
                <th className={th}>Price level</th>
                {markets
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <th key={m.code} className={cn(th, "text-right")}>
                      {m.name}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.code}>
                  <td className={cn(td, "font-semibold text-ink")}>
                    {t.name} <span className="font-normal text-ink-muted">+{(t.markupBps / 100).toFixed(2)}%</span>
                  </td>
                  {markets
                    .filter((m) => m.enabled)
                    .map((m) => {
                      const rate = m.currency === base ? null : asRate(rates.get(m.currency));
                      const missing = m.currency !== base && !rate;
                      return (
                        <td key={m.code} className={cn(td, "text-right tabular-nums")}>
                          {missing ? <span className="text-ink-muted">No rate yet</span> : formatMoney(customerPrice(cost, t.markupBps, m, rate), m.locale)}
                        </td>
                      );
                    })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card>
        <h2 className="text-headline font-bold">Currencies</h2>
        <p className="mt-1 text-callout text-ink-muted">Rates are fetched from {base} to every currency switched on here.</p>
        <ul className="mt-3 divide-y divide-line">
          {currencies.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                <span className="font-semibold text-ink">{c.code}</span> <span className="text-ink-muted">{c.name}</span>
                {c.code === base ? <span className="ml-2"><Badge tone="highlight">Base</Badge></span> : null}
                {!c.enabled ? <span className="ml-2"><Badge>Off</Badge></span> : null}
              </span>
              {canEdit && c.code !== base ? (
                <ActionForm action={currencyEnabledAction} hidden={{ code: c.code, enabled: c.enabled ? "no" : "yes" }} label={c.enabled ? "Switch off" : "Switch on"} />
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="mt-5 border-t border-line pt-5">
            <AddCurrencyForm />
          </div>
        ) : null}
      </Card>
    </>
  );
}
