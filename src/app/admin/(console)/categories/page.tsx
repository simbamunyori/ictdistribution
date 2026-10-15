import type { Metadata } from "next";
import Link from "next/link";
import { CategoryForm } from "@/components/admin/catalogue-forms";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { categoryTree } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Categories" };

export default async function Categories() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageCatalogue");
  const tree = await categoryTree(prisma);
  const parents = tree.map((c) => ({ value: c.id, label: c.name }));
  return (
    <>
      <PageHeader title="Categories" lead="Categories and subcategories, the specifications products in each carry, and what we suggest alongside them. Subcategories inherit their parent's specifications." />
      <Card className="mb-6">
        <ul className="divide-y divide-line">
          {tree.map((c) => (
            <li key={c.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/categories/${c.id}`} className="font-semibold text-link underline underline-offset-4">
                  {c.name}
                </Link>
                <span className="text-callout text-ink-muted">{c._count.products + c.children.reduce((a, s) => a + s._count.products, 0)} products</span>
                {!c.active ? <Badge tone="warning">Hidden</Badge> : null}
              </div>
              {c.children.length ? (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-4 text-callout">
                  {c.children.map((s) => (
                    <li key={s.id}>
                      <Link href={`/admin/categories/${s.id}`} className="text-link underline underline-offset-4">
                        {s.name}
                      </Link>{" "}
                      <span className="text-ink-muted">({s._count.products})</span>
                      {!s.active ? <span className="text-warning"> hidden</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {canEdit ? (
        <Card className="max-w-3xl">
          <h2 className="mb-4 text-headline font-bold">Add a category</h2>
          <CategoryForm readOnly={false} parents={parents} category={{ name: "", slug: "", description: "", parentId: "", sortOrder: String((tree.length + 1) * 10), active: true, sourcingRule: "", hsCode: "" }} />
        </Card>
      ) : null}
    </>
  );
}
