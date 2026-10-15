import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrowseView } from "@/components/shop/browse-view";
import { SiteFrame } from "@/components/site/site-frame";
import { compareIds } from "@/server/catalogue/compare";
import { findProducts } from "@/server/catalogue/search";
import { browse, browseParamsFrom, shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { shopPrices, shopWhere } from "@/server/shop/viewer";
import { company } from "@/config/app";
import { metaDescription } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await prisma.category.findUnique({ where: { slug: (await params).slug }, select: { name: true, description: true, active: true } });
  if (!c?.active) return { title: "Not found" };
  const slug = (await params).slug;
  const description = metaDescription(c.description || `${c.name} from ${company.name}, with prices, specifications and delivery across Southern Africa.`);
  return { title: c.name, description, alternates: { canonical: `/categories/${slug}` }, openGraph: { type: "website", title: c.name, description, url: `/categories/${slug}`, siteName: company.name } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const prices = await shopPrices();
  const [result, categories, compare] = await Promise.all([browse(prisma, { ...browseParamsFrom(search), category: slug }, prices), shopCategories(prisma), compareIds()]);
  if (!result?.category) notFound();
  const c = result.category;
  const top = categories.find((x) => x.id === (c.parentId ?? c.id));
  const close = !result.total && result.terms.length ? (await findProducts(prisma, { query: result.terms.join(" "), category: slug, limit: 6 }, prices)).items : [];
  const links = (top?.children ?? []).filter((s) => s.count).map((s) => ({ href: `/categories/${s.slug}`, label: s.name, count: s.count }));
  return (
    <SiteFrame back={`/categories/${slug}`}>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <nav aria-label="Breadcrumb" className="mb-2 text-callout">
          <ol className="flex flex-wrap gap-1 text-ink-muted">
            <li>
              <Link href="/products" className="text-link underline underline-offset-4">
                Products
              </Link>
            </li>
            {c.parent ? (
              <li>
                {" / "}
                <Link href={`/categories/${c.parent.slug}`} className="text-link underline underline-offset-4">
                  {c.parent.name}
                </Link>
              </li>
            ) : null}
          </ol>
        </nav>
        <h1 className="text-title font-bold">{c.name}</h1>
        {c.description ? <p className="mt-1 mb-6 max-w-2xl text-ink-muted">{c.description}</p> : <div className="mb-6" />}
        <BrowseView path={`/categories/${slug}`} search={search} result={result} compare={compare} where={await shopWhere()} categoryLinks={links} close={close} />
      </div>
    </SiteFrame>
  );
}
