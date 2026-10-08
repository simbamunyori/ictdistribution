import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { listAudit } from "@/server/audit";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

const AREAS = [
  { value: "", label: "Everything" },
  { value: "sign-in.", label: "Sign-in methods" },
  { value: "account.", label: "New customer accounts" },
  { value: "profile.", label: "Customer details" },
  { value: "organisation.", label: "Organisations" },
  { value: "member.", label: "Organisation teams" },
  { value: "staff.", label: "Staff" },
  { value: "market.", label: "Markets" },
  { value: "currency.", label: "Currencies" },
  { value: "rate.", label: "Exchange rates" },
  { value: "customer-type.", label: "Price levels" },
];

const ACTOR_TONE = { STAFF: "highlight", CUSTOMER: "neutral", SYSTEM: "positive" } as const;

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewAudit")) redirect("/admin");
  const area = AREAS.some((a) => a.value === q.area) ? q.area : "";
  const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before) : undefined;
  const events = await listAudit(prisma, { action: area || undefined, organisationId: q.organisation || undefined, before }, PAGE);
  const orgIds = [...new Set(events.map((e) => e.organisationId).filter((x): x is string => Boolean(x)))];
  const orgs = new Map((await prisma.organisation.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  const last = events.at(-1);
  const more = events.length === PAGE && last ? `/admin/audit?${new URLSearchParams({ ...(area ? { area } : {}), ...(q.organisation ? { organisation: q.organisation } : {}), before: last.createdAt.toISOString() })}` : null;

  return (
    <>
      <PageHeader title="Audit log" lead="Every change by staff, customers and the system, newest first. Nothing here can be edited or deleted." />
      <form className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-callout font-semibold">Area</span>
          <select name="area" defaultValue={area} className={cn(inputClass, "pr-8")}>
            {AREAS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {q.organisation ? <input type="hidden" name="organisation" value={q.organisation} /> : null}
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
        {q.organisation ? (
          <Link href="/admin/audit" className="py-2 font-semibold text-link underline underline-offset-4">
            Clear the organisation filter
          </Link>
        ) : null}
      </form>
      <Card>
        {events.length ? (
          <TableWrap label="Audit events">
            <table className="w-full min-w-[48rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>When (UTC)</th>
                  <th className={th}>Who</th>
                  <th className={th}>What</th>
                  <th className={th}>Organisation</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className={cn(td, "whitespace-nowrap tabular-nums")}>{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td className={td}>
                      <span className="block font-semibold text-ink">{e.actorLabel}</span>
                      <Badge tone={ACTOR_TONE[e.actorKind]}>{e.actorKind === "STAFF" ? "Staff" : e.actorKind === "CUSTOMER" ? "Customer" : "System"}</Badge>
                    </td>
                    <td className={td}>
                      <span className="block text-ink">{e.summary}</span>
                      <span className="text-caption text-ink-muted">
                        {e.action}
                        {e.ipAddress ? ` from ${e.ipAddress}` : ""}
                        {e.visibleToCustomer ? ", shown to the customer" : ""}
                      </span>
                    </td>
                    <td className={td}>
                      {e.organisationId ? (
                        <Link href={`/admin/audit?organisation=${e.organisationId}`} className="text-link underline underline-offset-4">
                          {orgs.get(e.organisationId) ?? "Organisation"}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">Nothing here yet.</p>
        )}
        {more ? (
          <p className="mt-4">
            <Link href={more} className="font-semibold text-link underline underline-offset-4">
              Older events
            </Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}
