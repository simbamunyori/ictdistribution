import type { Metadata } from "next";
import { BrowseView } from "@/components/shop/browse-view";
import { SiteFrame } from "@/components/site/site-frame";
import { compareIds } from "@/server/catalogue/compare";
import { browse, browseParamsFrom, shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { shopPrices } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Products", description: "Laptops, phones, monitors, storage, networking, servers and software, from the brands businesses trust." };

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const prices = await shopPrices();
  const [result, categories, compare] = await Promise.all([browse(prisma, browseParamsFrom(search), prices), shopCategories(prisma), compareIds()]);
  return (
    <SiteFrame back="/products">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="mb-6 text-title font-bold">{result?.terms.length ? "Search" : "All products"}</h1>
        <BrowseView path="/products" search={search} result={result!} compare={compare} where={{ locale: prices.market.locale, timeZone: prices.market.timeZone }} categoryLinks={categories.filter((c) => c.count).map((c) => ({ href: `/categories/${c.slug}`, label: c.name, count: c.count }))} />
      </div>
    </SiteFrame>
  );
}
