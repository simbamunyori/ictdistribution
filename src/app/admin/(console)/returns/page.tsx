import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listReturns, RETURN_REASON_LABEL, RETURN_STAFF_LABEL, RETURN_STATUS_TONE } from "@/server/portal/returns";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Returns" };

const STATUSES = Object.keys(RETURN_STAFF_LABEL) as (keyof typeof RETURN_STAFF_LABEL)[];

export default async function Returns({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewOrders")) redirect("/admin");
  const status = STATUSES.includes(q.status as (typeof STATUSES)[number]) ? (q.status as (typeof STATUSES)[number]) : undefined;
  const returns = await listReturns(prisma, { status });
  return (
    <>
      <PageHeader title="Returns" lead="Customers ask to send items back from their order pages. Answer each one: the customer is emailed at every step." />
      <nav aria-label="Which returns" className="mb-4 flex flex-wrap gap-2">
        {[["", "All"] as const, ...STATUSES.map((s) => [s, RETURN_STAFF_LABEL[s]] as const)].map(([k, label]) => (
          <Link key={k || "all"} href={k ? `/admin/returns?status=${k}` : "/admin/returns"} aria-current={(status ?? "") === k ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-callout font-semibold", (status ?? "") === k ? "bg-surface text-ink" : "text-link")}>
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {returns.length ? (
          <TableWrap label="Returns">
            <table className="w-full min-w-[44rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Return</th>
                  <th className={th}>Order</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Why</th>
                  <th className={th}>Asked</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <Link href={`/admin/returns/${r.id}`} className="font-semibold text-link underline underline-offset-4">
                        {r.number}
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`/admin/orders/${r.order.id}`} className="text-link underline underline-offset-4">
                        {r.order.number}
                      </Link>
                    </td>
                    <td className={td}>{r.order.organisation?.name ?? r.order.name}</td>
                    <td className={td}>{RETURN_REASON_LABEL[r.reason]}</td>
                    <td className={td}>{staffWhen(r.createdAt)}</td>
                    <td className={td}>
                      <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STAFF_LABEL[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p>No returns{status ? " like that" : " yet"}.</p>
        )}
      </Card>
    </>
  );
}
