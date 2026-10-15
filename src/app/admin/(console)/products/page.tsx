import type { ProductStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { listProducts, STATUS_LABEL } from "@/server/catalogue/products";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Products" };

const STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];
const TONE = { DRAFT: "warning", ACTIVE: "positive", ARCHIVED: "neutral" } as const;

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageCatalogue");
  const status = STATUSES.includes(q.status as ProductStatus) ? (q.status as ProductStatus) : undefined;
  const [categories, list] = await Promise.all([categoryOptions(prisma), listProducts(prisma, { q: q.q, categoryId: q.category || undefined, status, page: Number(q.page) || 1 })]);
  const pageHref = (page: number) => `/admin/products?${new URLSearchParams({ ...(q.q ? { q: q.q } : {}), ...(q.category ? { category: q.category } : {}), ...(status ? { status } : {}), page: String(page) })}`;
  return (
    <>
      <PageHeader title="Products" lead="Everything we sell. Drafts stay out of the shop until they are ready." actions={canEdit ? <ButtonLink href="/admin/products/new">Add product</ButtonLink> : null} />
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_14rem_12rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Name, brand or part number" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Category</span>
          <select name="category" defaultValue={q.category ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        <p className="text-callout text-ink-muted">
          {list.total} {list.total === 1 ? "product" : "products"}
        </p>
        {list.items.length ? (
          <TableWrap label="Products">
            <table className="mt-3 w-full min-w-[44rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Category</th>
                  <th className={th}>Suppliers</th>
                  <th className={th}>Images and files</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>
                      <Link href={`/admin/products/${p.id}`} className="font-semibold text-link underline underline-offset-4">
                        {p.brand.name} {p.name}
                      </Link>
                      <span className="block text-caption text-ink-muted">{p.mpn}</span>
                    </td>
                    <td className={td}>{p.category.name}</td>
                    <td className={cn(td, "tabular-nums")}>{p._count.offers || <span className="text-warning">None</span>}</td>
                    <td className={cn(td, "tabular-nums")}>{p._count.media}</td>
                    <td className={td}>
                      <Badge tone={TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="mt-3 text-ink-muted">No products match.</p>
        )}
        {list.pages > 1 ? (
          <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-callout">
            {list.page > 1 ? (
              <Link href={pageHref(list.page - 1)} className="text-link underline underline-offset-4">
                Previous
              </Link>
            ) : null}
            <span className="text-ink-muted">
              Page {list.page} of {list.pages}
            </span>
            {list.page < list.pages ? (
              <Link href={pageHref(list.page + 1)} className="text-link underline underline-offset-4">
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
