import { ArrowRight, BadgeCheck, Building2, FileText, Landmark, MessageSquareText, ShieldCheck, Tag, Truck } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/shop/category-icon";
import { BundleSpecials, CategorySpecials, ProductSpecials } from "@/components/shop/specials-view";
import { ProductCard } from "@/components/shop/product-card";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { currencyName } from "@/lib/money";
import { compareIds } from "@/server/catalogue/compare";
import { cardsFor, IN_SHOP, shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { featuredIds, shopSettings } from "@/server/shop/settings";
import { specialsFor } from "@/server/shop/showcase";
import { shopPrices, shopWhere } from "@/server/shop/viewer";

/** Brands with products in the shop, the busiest first. */
async function shopBrands() {
  const rows = await prisma.brand.findMany({ where: { products: { some: IN_SHOP } }, select: { name: true, slug: true, _count: { select: { products: { where: IN_SHOP } } } } });
  return rows.sort((a, b) => b._count.products - a._count.products || a.name.localeCompare(b.name)).slice(0, 12);
}

export default async function Home() {
  const prices = await shopPrices();
  const market = prices.market;
  const [settings, specials, featured, compare, categories, brands] = await Promise.all([shopSettings(prisma), specialsFor(prisma, prices, { featured: true }), featuredIds(prisma).then((ids) => cardsFor(prisma, ids, prices)), compareIds(), shopCategories(prisma), shopBrands()]);
  const where = await shopWhere();
  const shop = categories.filter((c) => c.count);
  const specialCount = specials.products.length + specials.bundles.length + specials.categories.length;

  return (
    <SiteFrame>
      <div className="mx-auto max-w-7xl px-4 pt-6 md:px-6">
        <section aria-labelledby="hero" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-lg bg-panel px-6 py-10 text-ink-on-dark sm:px-10 md:py-14">
            <Units />
            <div className="relative max-w-lg">
              <p className="kicker text-brand">{market.name}</p>
              <h1 id="hero" className="mt-3 text-display font-bold text-white">
                {settings.heroTitle}
              </h1>
              <p className="mt-4 text-headline">
                {settings.heroText} Prices in {currencyName(market.currency, market.locale).toLowerCase()}, including {market.taxName}.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/products" className={buttonClass("primary", "lg")}>
                  Shop the range
                  <ArrowRight aria-hidden />
                </Link>
                <Link href="/account/quotes/new" className={buttonClass("secondary", "lg", "border-white/30 bg-transparent text-white hover:bg-white/10")}>
                  Ask for a quote
                </Link>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Link href="/specials" className="group flex flex-col justify-between gap-6 rounded-lg border border-line bg-highlight-soft p-6 hover:border-highlight">
              <span className="flex size-11 items-center justify-center rounded-md bg-highlight text-on-highlight">
                <Tag aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block text-title font-bold text-ink">Specials</span>
                <span className="mt-1 block text-ink-body">{specialCount ? `${specialCount} ${specialCount === 1 ? "offer" : "offers"} on now, for a limited time.` : "Limited-time prices on laptops, memory and more."}</span>
                <span className="mt-3 inline-flex items-center gap-1 font-semibold text-link group-hover:underline group-hover:underline-offset-4">
                  See the specials
                  <ArrowRight aria-hidden className="size-4" />
                </span>
              </span>
            </Link>
            <Link href="/sign-up?for=business" className="group flex flex-col justify-between gap-6 rounded-lg border border-line bg-raised p-6 hover:border-accent">
              <span className="flex size-11 items-center justify-center rounded-md bg-accent-soft text-link">
                <Building2 aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block text-title font-bold text-ink">Trade accounts</span>
                <span className="mt-1 block text-ink-body">Business prices, quotes in hours, tenders and buying on account.</span>
                <span className="mt-3 inline-flex items-center gap-1 font-semibold text-link group-hover:underline group-hover:underline-offset-4">
                  Register your business
                  <ArrowRight aria-hidden className="size-4" />
                </span>
              </span>
            </Link>
          </div>
        </section>

        <ul aria-label="Why buy from us" className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: BadgeCheck, title: "Genuine products", text: "Full manufacturer warranty" },
            { icon: Truck, title: "Delivery or collection", text: `Anywhere in ${market.name}` },
            { icon: FileText, title: "Quotes and tenders", text: "Priced and sent fast" },
            { icon: Landmark, title: "Pay by bank transfer", text: "Or on account for businesses" },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3 bg-raised px-5 py-4">
              <Icon aria-hidden className="size-6 shrink-0 text-link" />
              <span className="leading-tight">
                <span className="block font-semibold text-ink">{title}</span>
                <span className="text-callout text-ink-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        {shop.length ? (
          <section aria-labelledby="categories" className="mt-14">
            <Heading id="categories" title="Shop by category" href="/products" link="All products" />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {shop.map((c) => {
                return (
                  <li key={c.id}>
                    <Link href={`/categories/${c.slug}`} className="group flex h-full flex-col items-center gap-3 rounded-lg border border-line bg-raised px-3 py-6 text-center hover:border-ink-muted hover:shadow-[0_4px_16px_rgb(0_0_0/0.08)]">
                      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-ink transition-colors group-hover:bg-highlight group-hover:text-on-highlight">
                        <CategoryIcon slug={c.slug} strokeWidth={1.5} className="size-8" />
                      </span>
                      <span>
                        <span className="block font-semibold text-ink">{c.name}</span>
                        <span className="text-caption text-ink-muted">
                          {c.count} {c.count === 1 ? "product" : "products"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {specials.any ? (
          <section aria-labelledby="specials" className="mt-14">
            <Heading id="specials" title="Specials" href="/specials" link="All specials" />
            <div className="flex flex-col gap-4">
              <ProductSpecials items={specials.products} compare={compare} back="/" where={where} />
              <BundleSpecials items={specials.bundles} where={where} />
              <CategorySpecials items={specials.categories} where={where} />
            </div>
          </section>
        ) : null}

        {featured.length ? (
          <section aria-labelledby="featured" className="mt-14">
            <Heading id="featured" title="Popular now" href="/products" link="All products" />
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {featured.map((p) => (
                <li key={p.id} className="flex">
                  <ProductCard product={p} comparing={compare.includes(p.id)} back="/" where={where} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {brands.length > 1 ? (
          <section aria-labelledby="brands" className="mt-14">
            <Heading id="brands" title="Shop by brand" />
            <ul className="flex flex-wrap gap-2">
              {brands.map((b) => (
                <li key={b.slug}>
                  <Link href={`/products?b=${encodeURIComponent(b.slug)}`} className="flex h-12 items-center gap-2 rounded-md border border-line bg-raised px-5 font-semibold text-ink hover:border-ink-muted hover:bg-surface">
                    {b.name}
                    <span className="text-caption font-normal text-ink-muted">{b._count.products}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Help choosing and buying" className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
            <MessageSquareText aria-hidden className="size-7 text-link" />
            <h2 className="mt-3 text-title font-bold">Not sure what you need?</h2>
            <p className="mt-2 text-ink-body">Tell our assistant what it is for and your budget. It suggests what fits from our range, and passes you to our team when you want a person.</p>
            <form action="/assistant" className="mt-5 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="home-ask" className="sr-only">
                What do you need?
              </label>
              <input id="home-ask" name="q" placeholder="For example: 5 laptops for an accounts team" className={cn(inputClass, "flex-1")} />
              <button type="submit" className={buttonClass("primary", "md")}>
                Ask
              </button>
            </form>
          </div>
          <div className="relative overflow-hidden rounded-lg bg-panel p-6 text-ink-on-dark sm:p-8">
            <Units />
            <div className="relative">
              <ShieldCheck aria-hidden className="size-7 text-brand" />
              <h2 className="mt-3 text-title font-bold text-white">Buying for a business?</h2>
              <p className="mt-2">Resellers, integrators, government and enterprise buyers get trade prices, fast quotes, tender support and a portal for the whole team.</p>
              <Link href="/sign-up?for=business" className={buttonClass("primary", "md", "mt-5")}>
                Register for trade prices
              </Link>
            </div>
          </div>
        </section>
      </div>
    </SiteFrame>
  );
}

function Heading({ id, title, href, link }: { id: string; title: string; href?: string; link?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-title font-bold">
        {title}
      </h2>
      {href && link ? (
        <Link href={href} className="inline-flex items-center gap-1 font-semibold text-link hover:underline hover:underline-offset-4">
          {link}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

/** The brand's stacked units, faint, in the corner of an Ink panel: stock moving from source to customer. */
function Units() {
  const cells = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0.5],
    [1, 1.5],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute top-1/2 right-8 hidden h-[200px] w-[200px] -translate-y-1/2 md:block">
      {cells.map(([x, y]) => (
        <span key={`${x}-${y}`} className="absolute size-14 rounded-[10px] bg-white/[0.07]" style={{ left: x * 68, top: y * 68 }} />
      ))}
      <span className="absolute size-14 rounded-[10px] bg-brand" style={{ left: 136, top: 68 }} />
    </div>
  );
}
