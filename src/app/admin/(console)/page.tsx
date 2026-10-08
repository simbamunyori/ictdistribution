import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { findPlaceholders } from "@/server/placeholders";
import { rateWarnings } from "@/server/pricing/rates";

export default async function AdminHome() {
  const session = await requireStaff();
  const [warnings, placeholders, organisations, individuals, staff, markets] = await Promise.all([
    rateWarnings(prisma),
    findPlaceholders(prisma, env()),
    prisma.organisation.count(),
    prisma.user.count({ where: { kind: "CUSTOMER", memberships: { none: { active: true } } } }),
    prisma.user.count({ where: { kind: "STAFF", deactivatedAt: null } }),
    prisma.market.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, currency: true } }),
  ]);
  const tiles = [
    { label: "Business customers", value: organisations, href: "/admin/customers" },
    { label: "Individual customers", value: individuals, href: "/admin/customers?type=INDIVIDUAL" },
    { label: "Staff", value: staff, href: "/admin/staff" },
    { label: "Markets open", value: markets.length, href: "/admin/markets" },
  ];
  return (
    <>
      <PageHeader title={`Hello, ${session.user.name.split(" ")[0]}`} lead={`Selling in ${markets.map((m) => `${m.name} (${m.currency})`).join(", ") || "no markets yet"}.`} />
      <div className="flex flex-col gap-3">
        {warnings.map((w) => (
          <Alert key={w} tone="warning">
            {w}{" "}
            <Link href="/admin/exchange-rates" className="font-semibold underline underline-offset-4">
              Exchange rates
            </Link>
          </Alert>
        ))}
        {placeholders.length ? (
          <Alert tone="info">
            <span className="font-semibold">Before customers use this server, replace these development values:</span>
            <ul className="mt-2 list-disc pl-5">
              {placeholders.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-line bg-raised p-5 hover:border-brand">
            <span className="block text-callout text-ink-muted">{t.label}</span>
            <span className="mt-1 block text-display font-extrabold tabular-nums">{t.value}</span>
          </Link>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="text-headline font-bold">Coming in the next milestones</h2>
        <p className="mt-1 text-ink-muted">The catalogue, suppliers and pricing, the shop and checkout, quotes, orders and delivery each get their own pages here as they are built.</p>
      </Card>
    </>
  );
}
