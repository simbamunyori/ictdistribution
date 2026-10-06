import type { Metadata } from "next";
import { acceptRateAction } from "@/app/admin/(console)/actions";
import { FetchRatesButton, RateRulesForm, SetRateForm } from "@/components/admin/forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { movedBps, parseRate } from "@/lib/pricing";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { currentRates, pricingSettings, rateWarnings } from "@/server/pricing/rates";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Exchange rates" };

const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

const SOURCE: Record<string, string> = { "open.er-api.com": "Fetched", staff: "Set by hand", seed: "Demo value" };

export default async function ExchangeRates() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageRates");
  const settings = await pricingSettings(prisma);
  const base = settings.baseCurrency;
  const [inUse, held, recent, currencies, warnings] = await Promise.all([
    currentRates(prisma, base),
    prisma.exchangeRate.findMany({ where: { heldBack: { not: null } }, orderBy: { fetchedAt: "desc" } }),
    prisma.exchangeRate.findMany({ orderBy: { fetchedAt: "desc" }, take: 20 }),
    prisma.currency.findMany({ where: { enabled: true, code: { not: base } }, orderBy: { code: "asc" } }),
    rateWarnings(prisma),
  ]);
  const staffNames = new Map((await prisma.user.findMany({ where: { id: { in: recent.map((r) => r.acceptedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        title="Exchange rates"
        lead={`Fetched automatically every six hours, from 1 ${base} to each currency we use. A rate that moves more than ${(settings.rateJumpHoldBps / 100).toFixed(1)}% is held back until an Admin or Finance accepts it.`}
        actions={canEdit ? <FetchRatesButton /> : null}
      />
      {warnings.length ? (
        <div className="mb-6 flex flex-col gap-3">
          {warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
        </div>
      ) : null}

      {held.length ? (
        <Card className="mb-6 border-highlight">
          <h2 className="text-headline font-bold">Waiting to be accepted</h2>
          <p className="mt-1 text-callout text-ink-muted">Prices keep using the rate before it until you accept. If it looks wrong, leave it; the next fetch replaces it.</p>
          <ul className="mt-3 divide-y divide-line">
            {held.map((r) => {
              const before = inUse.get(r.quote);
              const moved = before ? movedBps(parseRate(before.rate), parseRate(r.rate)) / 100 : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-semibold text-ink tabular-nums">
                      1 {r.base} = {r.rate} {r.quote}
                    </span>
                    <span className="text-callout text-ink-muted">
                      {before ? `In use now: ${before.rate}. ` : ""}
                      {moved !== null ? `Moved ${moved.toFixed(2)}%. ` : ""}
                      {r.heldBack}
                    </span>
                  </span>
                  {canEdit ? <ActionForm action={acceptRateAction} hidden={{ id: r.id }} label="Accept and use it" variant="primary" confirm={`Use 1 ${r.base} = ${r.rate} ${r.quote} for prices from now?`} /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="text-headline font-bold">In use now</h2>
        <TableWrap label="Rates in use">
          <table className="mt-3 w-full min-w-[32rem] text-callout">
            <thead>
              <tr>
                <th className={th}>Currency</th>
                <th className={cn(th, "text-right")}>1 {base} buys</th>
                <th className={th}>From</th>
                <th className={th}>Since</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => {
                const r = inUse.get(c.code);
                return (
                  <tr key={c.code}>
                    <td className={cn(td, "font-semibold text-ink")}>
                      {c.code} <span className="font-normal text-ink-muted">{c.name}</span>
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>{r ? r.rate : <span className="text-ink-muted">None yet</span>}</td>
                    <td className={td}>{r ? (r.source === "seed" ? <Badge tone="warning">Demo value</Badge> : SOURCE[r.source] ?? r.source) : ""}</td>
                    <td className={cn(td, "tabular-nums")}>{r ? when(r.fetchedAt) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-4 text-caption text-ink-muted">
          Last checked {settings.ratesCheckedAt ? when(settings.ratesCheckedAt) : "never"}.{" "}
          <a href="https://www.exchangerate-api.com" className="text-link underline underline-offset-4" rel="noopener">
            Rates by Exchange Rate API
          </a>
          .
        </p>
      </Card>

      {canEdit ? (
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <Card>
            <h2 className="text-headline font-bold">Set a rate by hand</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">For when the source is down or wrong. It is used straight away, until the next fetch brings a newer one.</p>
            <SetRateForm base={base} currencies={currencies.map((c) => ({ value: c.code, label: c.code }))} />
          </Card>
          <Card>
            <h2 className="text-headline font-bold">Rules</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">How far a rate may move before it waits for you, and when an old rate gets a warning.</p>
            <RateRulesForm holdPercent={(settings.rateJumpHoldBps / 100).toString()} maxAgeHours={settings.rateMaxAgeHours.toString()} />
          </Card>
        </div>
      ) : null}

      <Card>
        <h2 className="text-headline font-bold">Recent rates</h2>
        <TableWrap label="Recent rates">
          <table className="mt-3 w-full min-w-[40rem] text-callout">
            <thead>
              <tr>
                <th className={th}>Pair</th>
                <th className={cn(th, "text-right")}>Rate</th>
                <th className={th}>From</th>
                <th className={th}>Stored</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className={td}>
                    {r.base} to {r.quote}
                  </td>
                  <td className={cn(td, "text-right tabular-nums")}>{r.rate}</td>
                  <td className={td}>{SOURCE[r.source] ?? r.source}</td>
                  <td className={cn(td, "tabular-nums")}>{when(r.fetchedAt)}</td>
                  <td className={td}>
                    {r.heldBack ? <Badge tone="warning">Held back</Badge> : r.acceptedById ? `Accepted by ${staffNames.get(r.acceptedById) ?? "staff"}` : "Used"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
