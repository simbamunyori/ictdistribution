import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProcurementRulesForm } from "@/components/admin/procurement-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { procurementRulesForm } from "@/server/procurement/purchase-orders";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Purchase order rules" };

export default async function PurchaseOrderRules() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewPurchaseOrders")) redirect("/admin");
  const { base, values } = await procurementRulesForm(prisma);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/purchase-orders" className="text-link underline underline-offset-4">
          Purchase orders
        </Link>
      </p>
      <PageHeader title="Purchase order rules" lead="When a purchase order goes to its supplier without anyone approving it, and what every purchase order says about delivery and payment." />
      <Card className="max-w-4xl">
        <ProcurementRulesForm given={values} base={base} canEdit={staffCan(role, "manageProcurementRules")} />
      </Card>
    </>
  );
}
