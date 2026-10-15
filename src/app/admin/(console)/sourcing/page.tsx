import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DefaultRuleForm } from "@/components/admin/catalogue-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { SOURCING_RULE_DESCRIPTION, SOURCING_RULE_LABEL } from "@/lib/sourcing";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { pricingSettings } from "@/server/pricing/rates";
import { staffCan } from "@/server/staff/access";
import { categoryRules, productRules } from "@/server/suppliers/sourcing";

export const metadata: Metadata = { title: "Supplier choice" };

export default async function Sourcing() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewSuppliers")) redirect("/admin");
  const [settings, categories, products] = await Promise.all([pricingSettings(prisma), categoryRules(prisma), productRules(prisma)]);
  return (
    <>
      <PageHeader title="Supplier choice" lead="When several suppliers offer a product, a rule picks one. That supplier's landed cost is our cost, and every price level adds its markup to it." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <DefaultRuleForm current={settings.sourcingRule} readOnly={!staffCan(role, "manageSuppliers")} />
        </Card>
        <Card>
          <h2 className="text-headline font-bold">The rules</h2>
          <dl className="mt-3 flex flex-col gap-3 text-callout">
            {Object.entries(SOURCING_RULE_LABEL).map(([k, label]) => (
              <div key={k}>
                <dt className="font-semibold text-ink">{label}</dt>
                <dd className="text-ink-muted">{SOURCING_RULE_DESCRIPTION[k as keyof typeof SOURCING_RULE_DESCRIPTION]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-callout text-ink-muted">In every rule, a supplier who says they have none in stock is chosen only when nobody else has it. Switched-off suppliers and offers, and currencies without an exchange rate, are never chosen.</p>
        </Card>
        <Card>
          <h2 className="text-headline font-bold">Categories with their own rule</h2>
          {categories.length ? (
            <ul className="mt-3 flex flex-col gap-2 text-callout">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/categories/${c.id}`} className="text-link underline underline-offset-4">
                    {c.parent ? `${c.parent.name} / ` : ""}
                    {c.name}
                  </Link>
                  : {SOURCING_RULE_LABEL[c.sourcingRule!]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink-muted">None. Set one on a category&apos;s page.</p>
          )}
        </Card>
        <Card>
          <h2 className="text-headline font-bold">Products with their own rule</h2>
          {products.length ? (
            <ul className="mt-3 flex flex-col gap-2 text-callout">
              {products.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/products/${p.id}`} className="text-link underline underline-offset-4">
                    {p.brand.name} {p.name}
                  </Link>
                  : {SOURCING_RULE_LABEL[p.sourcingRule!]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink-muted">None. Set one on a product&apos;s page.</p>
          )}
        </Card>
      </div>
    </>
  );
}
