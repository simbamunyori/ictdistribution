import type { Metadata } from "next";
import Link from "next/link";
import { CreateOrganisationForm, ProfileForm } from "@/components/account/forms";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { countryName } from "@/lib/countries";
import { organisationsFor } from "@/server/accounts/organisations";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { currentMarket } from "@/server/markets/current";
import { ORG_ROLE_LABEL } from "@/server/org/access";
import { listCustomerTypes, ORGANISATION_TYPES, priceLevelFor } from "@/server/pricing/customer-types";
import { switchAction } from "./actions";

export const metadata: Metadata = { title: "Your account" };

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireCustomer("/account");
  const [orgs, level, { market, markets }, types, history] = await Promise.all([
    organisationsFor(prisma, session.userId),
    priceLevelFor(prisma, session.activeOrganisationId),
    currentMarket(),
    listCustomerTypes(prisma),
    prisma.auditEvent.findMany({ where: { subjectUserId: session.userId, visibleToCustomer: true }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const active = orgs.find((o) => o.id === session.activeOrganisationId);
  const dates = new Intl.DateTimeFormat(market.locale, { dateStyle: "medium", timeStyle: "short", timeZone: market.timeZone });

  return (
    <>
      <PageHeader title={q.welcome ? `Welcome, ${session.user.name.split(" ")[0]}` : "Your account"} lead={session.user.email} />
      {q.welcome ? (
        <Alert tone="positive" className="mb-6">
          Your account is ready.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-headline font-bold">Buying for</h2>
          <p className="mt-1 text-callout text-ink-muted">
            {active ? `${active.name}, as ${ORG_ROLE_LABEL[active.role]}` : "Yourself"} in {market.name}. Price level: <span className="font-semibold text-ink">{level.name}</span>.
          </p>
          {orgs.length ? (
            <ul className="mt-4 flex flex-col gap-2">
              {[{ id: "", name: "Myself", role: null, customerType: null }, ...orgs].map((o) => {
                const current = (o.id || null) === (session.activeOrganisationId ?? null);
                return (
                  <li key={o.id || "me"}>
                    <form action={switchAction} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
                      <input type="hidden" name="organisationId" value={o.id} />
                      <span>
                        <span className="block font-semibold text-ink">{o.name}</span>
                        {o.role ? <span className="text-callout text-ink-muted">{ORG_ROLE_LABEL[o.role]}</span> : null}
                      </span>
                      {current ? <Badge tone="positive">Now</Badge> : <Button type="submit" size="sm" variant="secondary">Switch</Button>}
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Your details</h2>
          <div className="mt-4">
            <ProfileForm name={session.user.name} phone={session.user.phone} />
          </div>
        </Card>

        <Card id="business" className={q.add === "business" ? "ring-2 ring-focus" : undefined}>
          <h2 className="text-headline font-bold">Buying for a business?</h2>
          <p className="mt-1 text-callout text-ink-muted">Set up your organisation to get trade prices once we have verified it, quotes, and a team account with Owner, Buyer, Finance and Viewer roles.</p>
          <div className="mt-4">
            <CreateOrganisationForm
              countries={markets.map((m) => ({ value: m.country, label: countryName(m.country) }))}
              defaultCountry={market.country}
              types={types.filter((t) => ORGANISATION_TYPES.includes(t.code)).map((t) => ({ value: t.code, label: t.name }))}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Recent activity</h2>
          {history.length ? (
            <ul className="mt-3 divide-y divide-line">
              {history.map((e) => (
                <li key={e.id} className="py-2.5">
                  <p className="text-ink">{e.summary}</p>
                  <p className="text-caption text-ink-muted">{dates.format(e.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-callout text-ink-muted">Nothing yet.</p>
          )}
          <p className="mt-4 text-callout">
            <Link href="/account/sign-in-methods" className="text-link underline underline-offset-4">
              Manage how you sign in
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
