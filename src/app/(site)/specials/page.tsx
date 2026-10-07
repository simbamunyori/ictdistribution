import type { Metadata } from "next";
import Link from "next/link";
import { BusinessPrompt } from "@/components/shop/business-prompt";
import { BundleSpecials, CategorySpecials, ProductSpecials } from "@/components/shop/specials-view";
import { SiteFrame } from "@/components/site/site-frame";
import { compareIds } from "@/server/catalogue/compare";
import { prisma } from "@/server/db";
import { specialsFor } from "@/server/shop/showcase";
import { shopPrices } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Specials", description: "Lower prices on laptops, phones, monitors and more, for a limited time." };

export default async function SpecialsPage() {
  const prices = await shopPrices();
  const [specials, compare] = await Promise.all([specialsFor(prisma, prices), compareIds()]);
  const where = { locale: prices.market.locale, timeZone: prices.market.timeZone };
  return (
    <SiteFrame back="/specials">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="text-title font-bold">Specials</h1>
        <p className="mt-1 max-w-2xl text-ink-muted">Lower prices for a limited time, in {prices.market.name}. Each one ends on its date or when its stock runs out.</p>
        {specials.any ? (
          <div className="mt-8 flex flex-col gap-12">
            {specials.products.length ? (
              <section aria-labelledby="on-special">
                <h2 id="on-special" className="mb-4 text-headline font-bold">
                  On special
                </h2>
                <ProductSpecials items={specials.products} compare={compare} back="/specials" where={where} />
              </section>
            ) : null}
            {specials.bundles.length ? (
              <section aria-labelledby="bundles">
                <h2 id="bundles" className="mb-4 text-headline font-bold">
                  Bundles
                </h2>
                <BundleSpecials items={specials.bundles} where={where} />
              </section>
            ) : null}
            {specials.categories.length ? (
              <section aria-labelledby="ranges">
                <h2 id="ranges" className="mb-4 text-headline font-bold">
                  Whole ranges
                </h2>
                <CategorySpecials items={specials.categories} where={where} />
              </section>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-line bg-raised p-6">
            <p className="font-semibold">No specials right now.</p>
            <p className="mt-1 text-ink-muted">
              New ones start often.{" "}
              <Link href="/products" className="text-link underline underline-offset-4">
                Browse the range
              </Link>{" "}
              meanwhile.
            </p>
          </div>
        )}
        <BusinessPrompt className="mt-12" />
      </div>
    </SiteFrame>
  );
}
