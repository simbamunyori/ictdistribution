import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logisticsRulesAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { LogisticsNav } from "@/components/logistics/logistics-nav";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { INCOTERMS, logisticsRulesForm } from "@/server/logistics/rules";
import { defaultWarehouse } from "@/server/logistics/stock";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Logistics rules" };

export default async function LogisticsRules() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const canEdit = staffCan(role, "manageLogisticsRules");
  const [v, warehouse] = await Promise.all([logisticsRulesForm(prisma), defaultWarehouse(prisma)]);
  return (
    <>
      <PageHeader title="Logistics rules" lead="How landed costs are estimated, and whether orders use our stock or go straight from the supplier to the customer." />
      <LogisticsNav current="/admin/logistics/rules" />
      <Card className="max-w-4xl">
        <SpecForm
          action={logisticsRulesAction}
          disabled={!canEdit}
          fields={[
            { kind: "text", id: "homeCountry", label: "Where goods land", hint: warehouse ? `The default warehouse, ${warehouse.code}, is in ${warehouse.country}; that country is used while it is the default.` : "Two letters. Used for duty until there is a default warehouse.", defaultValue: v.homeCountry },
            { kind: "select", id: "incoterm", label: "Incoterm on commercial invoices", options: INCOTERMS.map((t) => ({ value: t, label: t })), defaultValue: v.incoterm },
            { kind: "text", id: "airKgPerM3", label: "Air: kg per cubic metre", inputMode: "numeric", hint: "Volumetric factor. Usually 167.", defaultValue: v.airKgPerM3 },
            { kind: "text", id: "courierKgPerM3", label: "Courier: kg per cubic metre", inputMode: "numeric", hint: "Usually 200.", defaultValue: v.courierKgPerM3 },
            { kind: "text", id: "roadKgPerM3", label: "Road: kg per cubic metre", inputMode: "numeric", hint: "Usually 333.", defaultValue: v.roadKgPerM3 },
            { kind: "text", id: "seaKgPerM3", label: "Sea: kg per cubic metre", inputMode: "numeric", hint: "Usually 1000.", defaultValue: v.seaKgPerM3 },
            { kind: "text", id: "insurancePercent", label: "Insurance % of goods value", inputMode: "decimal", hint: "Used when the history shows no insurance.", defaultValue: v.insurancePercent },
            { kind: "text", id: "sampleSize", label: "Shipments to learn from per route", inputMode: "numeric", hint: "The most recent ones. Fewer follows rate changes faster.", defaultValue: v.sampleSize },
            { kind: "checkbox", id: "useStock", label: "Fill orders from our stock first", hint: "When the default warehouse has enough free, the line is kept from stock instead of bought.", defaultChecked: v.useStock },
            { kind: "checkbox", id: "dropShipByDefault", label: "Ask suppliers to deliver straight to customers", hint: "For delivery orders. The supplier then sees the customer's name, phone and address. Staff can change it on each purchase order before it is sent.", defaultChecked: v.dropShipByDefault },
          ]}
          submitLabel="Save rules"
          pendingLabel="Saving"
        />
        {!canEdit ? <p className="mt-4 text-callout text-ink-muted">Only an Admin can change these rules.</p> : null}
        <p className="mt-4 text-callout">
          Warehouses are set up under{" "}
          <Link href="/admin/stock" className="text-link underline underline-offset-4">
            Stock
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
