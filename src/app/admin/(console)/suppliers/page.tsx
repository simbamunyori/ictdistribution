import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { countryName } from "@/lib/countries";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";
import { listSuppliers, SUPPLIER_KIND_LABEL } from "@/server/suppliers/suppliers";

export const metadata: Metadata = { title: "Suppliers" };

export default async function Suppliers() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewSuppliers")) redirect("/admin");
  const suppliers = await listSuppliers(prisma);
  return (
    <>
      <PageHeader title="Suppliers" lead="Who we buy from. Internal only: customers never see supplier names, prices or where stock comes from." actions={staffCan(role, "manageSuppliers") ? <ButtonLink href="/admin/suppliers/new">Add supplier</ButtonLink> : null} />
      <Card>
        {suppliers.length ? (
          <TableWrap label="Suppliers">
            <table className="w-full min-w-[46rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Supplier</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Bills in</th>
                  <th className={th}>Lead time</th>
                  <th className={th}>Offers</th>
                  <th className={th}>Supplies</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/admin/suppliers/${s.id}`} className="font-semibold text-link underline underline-offset-4">
                        {s.name}
                      </Link>{" "}
                      {s.preferred ? <Badge>Preferred</Badge> : null} {!s.active ? <Badge tone="warning">Switched off</Badge> : null}
                      {s.imports.length ? <span className="block text-caption font-semibold text-warning">Price list waiting for review</span> : null}
                    </td>
                    <td className={td}>
                      {SUPPLIER_KIND_LABEL[s.kind]}
                      <span className="block text-caption text-ink-muted">{countryName(s.country)}</span>
                    </td>
                    <td className={td}>{s.currency}</td>
                    <td className={cn(td, "tabular-nums")}>{s.leadTimeDays} days</td>
                    <td className={cn(td, "tabular-nums")}>{s._count.offers}</td>
                    <td className={td}>{s.categories.map((c) => c.category.name).join(", ") || <span className="text-ink-muted">Not set</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No suppliers yet.</p>
        )}
      </Card>
    </>
  );
}
