import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCategoryAction, removeSpecFieldAction } from "@/app/admin/(console)/catalogue-actions";
import { CategoryForm, SpecFieldForm, SuggestionsForm } from "@/components/admin/catalogue-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions, categoryTree, SPEC_KIND_LABEL } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Category" };

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageCatalogue");
  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
      parent: { include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } },
      suggests: { select: { relatedId: true } },
      _count: { select: { products: true, children: true } },
    },
  });
  if (!category) notFound();
  const [tree, options] = await Promise.all([categoryTree(prisma), categoryOptions(prisma)]);
  const parents = tree.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: c.name }));
  const kinds = Object.entries(SPEC_KIND_LABEL).map(([value, label]) => ({ value, label }));
  const yes = (b: boolean) => (b ? "Yes" : "No");

  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/categories" className="text-link underline underline-offset-4">
          Categories
        </Link>
        {category.parent ? (
          <>
            {" / "}
            <Link href={`/admin/categories/${category.parent.id}`} className="text-link underline underline-offset-4">
              {category.parent.name}
            </Link>
          </>
        ) : null}
      </p>
      <PageHeader
        title={category.name}
        lead={
          <>
            {category._count.products} products directly in it. In the shop at{" "}
            <Link href={`/categories/${category.slug}`} className="text-link underline underline-offset-4">
              /categories/{category.slug}
            </Link>
            .
          </>
        }
        actions={
          <Link href={`/admin/products?category=${category.id}`} className="h-9 rounded-md border border-line bg-raised px-3 py-1.5 text-callout font-semibold hover:bg-surface">
            Its products
          </Link>
        }
      />
      {q.created ? (
        <Alert tone="positive" className="mb-6">
          Added. Now give it the specifications its products carry.
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CategoryForm
          readOnly={!canEdit}
          parents={parents}
          category={{ id: category.id, name: category.name, slug: category.slug, description: category.description, parentId: category.parentId ?? "", sortOrder: String(category.sortOrder), active: category.active, sourcingRule: category.sourcingRule ?? "" }}
        />
      </Card>

      <Card className="mb-6">
        <h2 className="text-headline font-bold">Specifications</h2>
        <p className="mt-1 text-ink-muted">What every product here is described by. Shoppers filter by them and compare them side by side.</p>
        {category.parent?.specFields.length ? (
          <>
            <h3 className="mt-5 font-semibold">From {category.parent.name}</h3>
            <TableWrap label={`Specifications from ${category.parent.name}`}>
              <table className="mt-2 w-full min-w-[36rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Kind</th>
                    <th className={th}>Filter</th>
                    <th className={th}>On cards</th>
                  </tr>
                </thead>
                <tbody>
                  {category.parent.specFields.map((f) => (
                    <tr key={f.id}>
                      <td className={cn(td, "font-semibold text-ink")}>{f.label}</td>
                      <td className={td}>
                        {SPEC_KIND_LABEL[f.kind]}
                        {f.unit ? `, ${f.unit}` : ""}
                      </td>
                      <td className={td}>{yes(f.filterable)}</td>
                      <td className={td}>{yes(f.highlight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : null}
        <div className="mt-5 flex flex-col gap-4">
          {category.specFields.map((f) => (
            <details key={f.id} className="rounded-md border border-line p-4">
              <summary className="cursor-pointer font-semibold">
                {f.label} <span className="font-normal text-ink-muted">{SPEC_KIND_LABEL[f.kind]}{f.unit ? `, ${f.unit}` : ""}</span>{" "}
                {f.highlight ? <Badge>On cards</Badge> : null} {f.mustMatch ? <Badge>Must match</Badge> : null}
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <SpecFieldForm
                  categoryId={category.id}
                  kinds={kinds}
                  readOnly={!canEdit}
                  spec={{ id: f.id, label: f.label, key: f.key, kind: f.kind, unit: f.unit, options: f.options.join("\n"), filterable: f.filterable, highlight: f.highlight, mustMatch: f.mustMatch, sortOrder: String(f.sortOrder) }}
                />
                {canEdit ? <ActionForm action={removeSpecFieldAction} hidden={{ id: f.id, categoryId: category.id }} label="Remove this specification" variant="destructive" confirm={`Remove ${f.label}? Products keep their values, unused, in case you add it back.`} /> : null}
              </div>
            </details>
          ))}
          {!category.specFields.length ? <p className="text-ink-muted">No specifications of its own yet.</p> : null}
        </div>
        {canEdit ? (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="mb-4 font-semibold">Add a specification</h3>
            <SpecFieldForm categoryId={category.id} kinds={kinds} readOnly={false} spec={{ label: "", key: "", kind: "TEXT", unit: "", options: "", filterable: true, highlight: false, mustMatch: false, sortOrder: String((category.specFields.length + 1) * 10) }} />
          </div>
        ) : null}
      </Card>

      <Card className="mb-6">
        <h2 className="text-headline font-bold">Suggest alongside</h2>
        <p className="mt-1 mb-4 text-ink-muted">Product pages here suggest items from these categories. Where both have a specification marked &ldquo;must match&rdquo;, such as the memory type, only matching items are suggested.</p>
        <SuggestionsForm categoryId={category.id} options={options.filter((o) => o.value !== category.id)} chosen={category.suggests.map((s) => s.relatedId)} readOnly={!canEdit} />
      </Card>

      {canEdit && !category._count.products && !category._count.children ? (
        <Card>
          <h2 className="text-headline font-bold">Remove this category</h2>
          <p className="mt-1 mb-4 text-ink-muted">It has no products or subcategories, so it can go.</p>
          <ActionForm action={deleteCategoryAction} hidden={{ id: category.id }} label="Remove category" variant="destructive" confirm={`Remove ${category.name}?`} />
        </Card>
      ) : null}
    </>
  );
}
