import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/catalogue-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { brandNames } from "@/server/catalogue/products";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Add a product" };

export default async function NewProduct({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageCatalogue")) redirect("/admin/products");
  const [categories, brands] = await Promise.all([categoryOptions(prisma), brandNames(prisma)]);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/products" className="text-link underline underline-offset-4">
          Products
        </Link>
      </p>
      <PageHeader title="Add a product" lead="Start with the basics. Specifications, images, datasheets and suppliers come next, on the product's page." />
      <Card className="max-w-3xl">
        <ProductForm
          readOnly={false}
          categories={categories}
          brands={brands}
          product={{ name: "", brand: "", mpn: "", categoryId: q.category ?? "", slug: "", summary: "", description: "", warrantyMonths: "12", warrantyTerms: "Manufacturer, carry-in", sellToIndividuals: false, status: "DRAFT", sourcingRule: "" }}
        />
      </Card>
    </>
  );
}
