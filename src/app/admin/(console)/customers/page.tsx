import type { CustomerTypeCode } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { organisationTypeAction } from "@/app/admin/(console)/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { listCustomers } from "@/server/accounts/organisations";
import { VERIFICATION_LABEL } from "@/server/accounts/verification";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCustomerTypes, ORGANISATION_TYPES } from "@/server/pricing/customer-types";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Customers" };

const CHECK_TONE = { NOT_SUBMITTED: "neutral", PENDING: "warning", APPROVED: "positive", REJECTED: "negative" } as const;
const date = (d: Date) => d.toISOString().slice(0, 10);

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const actor = { userId: session.userId, name: session.user.name, staffRole: session.user.staffRole };
  if (!staffCan(actor, "viewCustomers")) redirect("/admin");
  const types = await listCustomerTypes(prisma);
  const type = types.some((t) => t.code === q.type) ? (q.type as CustomerTypeCode) : undefined;
  const waiting = q.check === "waiting";
  const { organisations, individuals } = await listCustomers(prisma, actor, { type, q: q.q, waiting });
  const canChange = staffCan(actor, "manageCustomers");
  const typeName = new Map(types.map((t) => [t.code, t.name]));
  const orgTypes = types.filter((t) => ORGANISATION_TYPES.includes(t.code)).map((t) => ({ value: t.code, label: t.name }));

  return (
    <>
      <PageHeader title="Customers" lead="Each customer's type sets their price level. Individuals are one person; business types are organisations with a team." />
      <form className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end" role="search">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Name or email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 sm:w-56">
          <span className="text-callout font-semibold">Type</span>
          <select name="type" defaultValue={type ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 sm:h-11">
          <input type="checkbox" name="check" value="waiting" defaultChecked={waiting} className="size-4 accent-[var(--t-primary)]" />
          <span className="text-callout font-semibold">Waiting to be checked</span>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>

      {type !== "INDIVIDUAL" || waiting ? (
        <Card className="mb-6">
          <h2 className="text-headline font-bold">Organisations</h2>
          {organisations.length ? (
            <TableWrap label="Organisations">
              <table className="mt-3 w-full min-w-[46rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Country</th>
                    <th className={th}>People</th>
                    <th className={th}>Joined</th>
                    <th className={th}>Check</th>
                    <th className={th}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {organisations.map((o) => (
                    <tr key={o.id}>
                      <td className={cn(td, "font-semibold text-ink")}>
                        <Link href={`/admin/customers/${o.id}`} className="text-link underline underline-offset-4">
                          {o.name}
                        </Link>
                        {o.registrationNumber ? <span className="block text-caption font-normal text-ink-muted">Reg. {o.registrationNumber}</span> : null}
                      </td>
                      <td className={td}>{o.country}</td>
                      <td className={cn(td, "tabular-nums")}>{o._count.memberships}</td>
                      <td className={cn(td, "tabular-nums")}>{date(o.createdAt)}</td>
                      <td className={td}>
                        <Badge tone={CHECK_TONE[o.verification]}>{VERIFICATION_LABEL[o.verification]}</Badge>
                      </td>
                      <td className={td}>
                        {canChange ? (
                          <ActionForm action={organisationTypeAction} hidden={{ organisationId: o.id }} label="Change">
                            <label className="sr-only" htmlFor={`type-${o.id}`}>
                              Type for {o.name}
                            </label>
                            <select id={`type-${o.id}`} name="type" defaultValue={o.customerType} className={cn(inputClass, "h-9 w-auto pr-8")}>
                              {orgTypes.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </ActionForm>
                        ) : (
                          <Badge>{typeName.get(o.customerType)}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2 text-ink-muted">No organisations match.</p>
          )}
        </Card>
      ) : null}

      {(!type || type === "INDIVIDUAL") && !waiting ? (
        <Card>
          <h2 className="text-headline font-bold">Individuals</h2>
          {individuals.length ? (
            <TableWrap label="Individuals">
              <table className="mt-3 w-full min-w-[32rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Email</th>
                    <th className={th}>Market</th>
                    <th className={th}>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {individuals.map((u) => (
                    <tr key={u.id}>
                      <td className={cn(td, "font-semibold text-ink")}>
                        {u.name}
                        {u.deactivatedAt ? <span className="ml-2"><Badge tone="negative">Switched off</Badge></span> : null}
                      </td>
                      <td className={cn(td, "break-all")}>{u.email}</td>
                      <td className={cn(td, "uppercase")}>{u.marketCode ?? ""}</td>
                      <td className={cn(td, "tabular-nums")}>{date(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2 text-ink-muted">No individuals match.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}
