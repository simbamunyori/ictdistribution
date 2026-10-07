import type { Metadata } from "next";
import Link from "next/link";
import { clearCompareAction } from "@/app/(site)/compare-actions";
import { CompareToggle, ProductImage } from "@/components/shop/product-card";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { TableWrap } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { compareIds } from "@/server/catalogue/compare";
import { compareProducts } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Compare products", robots: { index: false } };

export default async function Compare({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const ids = await compareIds();
  const { products, rows } = await compareProducts(prisma, ids);
  const onlyDiff = q.diff === "1" && products.length > 1;
  const shown = onlyDiff ? rows.filter((r) => r.differs) : rows;
  return (
    <SiteFrame back="/compare">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="text-title font-bold">Compare products</h1>
        {products.length ? (
          <>
            <div className="mt-2 mb-6 flex flex-wrap items-center gap-4 text-callout">
              <p className="text-ink-muted">Up to four at a time. Adding a fifth replaces the first.</p>
              {products.length > 1 ? (
                <Link href={onlyDiff ? "/compare" : "/compare?diff=1"} className="text-link underline underline-offset-4">
                  {onlyDiff ? "Show everything" : "Show only differences"}
                </Link>
              ) : null}
              <form action={clearCompareAction}>
                <button type="submit" className="text-link underline underline-offset-4">
                  Clear the list
                </button>
              </form>
            </div>
            <TableWrap label="Products side by side">
              <table className="w-full min-w-[40rem] table-fixed border-collapse text-callout">
                <caption className="sr-only">Specifications of the products you are comparing</caption>
                <thead>
                  <tr>
                    <td className="w-40 border-b border-line" />
                    {products.map((p) => (
                      <th key={p.id} scope="col" className="border-b border-line p-3 text-left align-top font-normal">
                        <ProductImage image={p.image} className="aspect-[4/3] w-full rounded-md border border-line" />
                        <span className="mt-2 block text-caption font-semibold text-ink-muted uppercase">{p.brand}</span>
                        <Link href={`/products/${p.slug}`} className="block font-bold text-ink hover:text-link hover:underline">
                          {p.name}
                        </Link>
                        <div className="mt-2">
                          <CompareToggle id={p.id} comparing back="/compare" />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key}>
                      <th scope="row" className="border-b border-line p-3 text-left align-top font-semibold text-ink-muted">
                        {r.label}
                      </th>
                      {r.values.map((v, i) => (
                        <td key={products[i].id} className={cn("border-b border-line p-3 align-top", r.differs && "font-semibold text-ink")}>
                          {v || <span className="text-ink-muted">Not given</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-line bg-raised p-6">
            <p className="font-semibold">Nothing to compare yet.</p>
            <p className="mt-1 text-ink-muted">Press Compare on up to four products and they line up here, specification by specification.</p>
            <Link href="/products" className={buttonClass("primary", "md", "mt-4")}>
              Browse products
            </Link>
          </div>
        )}
      </div>
    </SiteFrame>
  );
}
