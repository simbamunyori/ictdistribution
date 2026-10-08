import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SupplierForm } from "@/components/admin/catalogue-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { countryOptions } from "@/lib/countries";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Add a supplier" };

export default async function NewSupplier() {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageSuppliers")) redirect("/admin/suppliers");
  const currencies = (await listCurrencies(prisma)).filter((c) => c.enabled).map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` }));
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/suppliers" className="text-link underline underline-offset-4">
          Suppliers
        </Link>
      </p>
      <PageHeader title="Add a supplier" lead="Contacts, categories, price lists and their performance record come next, on the supplier's page." />
      <Card className="max-w-3xl">
        <SupplierForm
          readOnly={false}
          countries={countryOptions()}
          currencies={currencies}
          supplier={{ name: "", kind: "LOCAL", country: "", currency: "USD", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "5", minOrder: "", landedCostPercent: "0", preferred: false, active: true }}
        />
      </Card>
    </>
  );
}
