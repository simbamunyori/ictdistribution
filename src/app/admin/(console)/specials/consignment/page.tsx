import type { Metadata } from "next";
import Link from "next/link";
import { SpecialForm } from "@/components/admin/shop-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";
import { blankSpecial, specialFormOptions } from "../form-data";

export const metadata: Metadata = { title: "Launch stock as a special" };

export default async function Consignment() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const [options, currencies] = await Promise.all([specialFormOptions(), listCurrencies(prisma)]);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/specials" className="text-link underline underline-offset-4">
          Specials
        </Link>
      </p>
      <PageHeader title="Launch stock as a special" lead="For stock we bring in ourselves, such as a consignment of laptops. It is recorded as our own stock at its landed cost, and goes on sale at the special price until the units are sold." />
      <Card className="max-w-3xl">
        <SpecialForm
          special={blankSpecial()}
          readOnly={!canEdit}
          {...options}
          consignment={{ currencies: currencies.filter((c) => c.enabled).map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` })), defaultCurrency: "USD" }}
        />
      </Card>
    </>
  );
}
