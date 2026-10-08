import type { Metadata } from "next";
import { BrowseView } from "@/components/shop/browse-view";
import { SiteFrame } from "@/components/site/site-frame";
import { compareIds } from "@/server/catalogue/compare";
import { findProducts } from "@/server/catalogue/search";
import { browse, browseParamsFrom, shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { shopPrices, shopWhere } from "@/server/shop/viewer";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const search = await searchParams;
  // Search results and filtered lists are not pages to show in search engines; the full list is.
  const filtered = Object.keys(search).some((k) => k !== "page");
  return { title: search.q ? "Search" : "Products", description: "Laptops, phones, monitors, storage, networking, servers and software, from the brands businesses trust.", alternates: { canonical: "/products" }, ...(filtered ? { robots: { index: false, follow: true } } : {}) };
}

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const prices = await shopPrices();
  const [result, categories, compare] = await Promise.all([browse(prisma, browseParamsFrom(search), prices), shopCategories(prisma), compareIds()]);
  // A search that finds nothing shows what is spelled or worded like it.
  const close = result && !result.total && result.terms.length ? (await findProducts(prisma, { query: result.terms.join(" "), limit: 6 }, prices)).items : [];
  return (
    <SiteFrame back="/products">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="mb-6 text-title font-bold">{result?.terms.length ? "Search" : "All products"}</h1>
        <BrowseView path="/products" search={search} result={result!} compare={compare} where={await shopWhere()} categoryLinks={categories.filter((c) => c.count).map((c) => ({ href: `/categories/${c.slug}`, label: c.name, count: c.count }))} close={close} />
      </div>
    </SiteFrame>
  );
}
