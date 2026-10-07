import { Building2, Laptop, Network, Server, ShieldCheck, Smartphone, Truck, User } from "lucide-react";
import Link from "next/link";
import { BundleSpecials, CategorySpecials, ProductSpecials } from "@/components/shop/specials-view";
import { ProductCard } from "@/components/shop/product-card";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { currencyName } from "@/lib/money";
import { compareIds } from "@/server/catalogue/compare";
import { cardsFor } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { featuredIds, shopSettings } from "@/server/shop/settings";
import { specialsFor } from "@/server/shop/showcase";
import { shopPrices, shopWhere } from "@/server/shop/viewer";

const RANGE = [
  { icon: Laptop, title: "Laptops and desktops", text: "Everyday notebooks to workstations, with monitors, SSDs and memory." },
  { icon: Smartphone, title: "Phones", text: "Current flagship models and dependable everyday phones." },
  { icon: Network, title: "Networking", text: "Switches, routers, access points, Wi-Fi extenders and firewalls." },
  { icon: Server, title: "Servers and power", text: "Servers, storage, UPS units, cabling and software licences." },
];

export default async function Home() {
  const prices = await shopPrices();
  const market = prices.market;
  const [settings, specials, featured, compare] = await Promise.all([shopSettings(prisma), specialsFor(prisma, prices, { featured: true }), featuredIds(prisma).then((ids) => cardsFor(prisma, ids, prices)), compareIds()]);
  const where = await shopWhere();
  return (
    <SiteFrame>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.3fr_1fr] md:items-center md:px-6 md:py-20">
          <div>
            <p className="kicker text-link">{market.name}</p>
            <h1 className="mt-3 text-display font-extrabold">{settings.heroTitle}</h1>
            <p className="mt-5 max-w-xl text-headline text-ink-body">
              {settings.heroText} Prices in {currencyName(market.currency, market.locale).toLowerCase()}, including {market.taxName}.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/products" className={buttonClass("primary", "lg")}>
                Shop the range
              </Link>
              <Link href="/specials" className={buttonClass("secondary", "lg")}>
                See the specials
              </Link>
            </div>
            <p className="mt-4 text-callout text-ink-muted">
              Buying for a business?{" "}
              <Link href="/sign-up?for=business" className="font-semibold text-link underline underline-offset-4">
                Register for trade prices
              </Link>
              .
            </p>
          </div>
          <ul className="grid gap-3">
            {[
              { icon: ShieldCheck, text: "Genuine products with full manufacturer warranty" },
              { icon: Truck, text: "Delivery to your door, or collect from us" },
              { icon: Building2, text: "Trade prices, quotes and tender support for businesses" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-lg border border-line bg-raised p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-link">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="font-semibold text-ink">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {specials.any ? (
        <section className="mx-auto max-w-6xl px-4 pt-14 md:px-6" aria-labelledby="specials">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="specials" className="text-title font-bold">
              Specials
            </h2>
            <Link href="/specials" className="font-semibold text-link underline underline-offset-4">
              All specials
            </Link>
          </div>
          <div className="flex flex-col gap-6">
            <ProductSpecials items={specials.products} compare={compare} back="/" where={where} />
            <BundleSpecials items={specials.bundles} where={where} />
            <CategorySpecials items={specials.categories} where={where} />
          </div>
        </section>
      ) : null}

      {featured.length ? (
        <section className="mx-auto max-w-6xl px-4 pt-14 md:px-6" aria-labelledby="featured">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="featured" className="text-title font-bold">
              Popular now
            </h2>
            <Link href="/products" className="font-semibold text-link underline underline-offset-4">
              All products
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => (
              <li key={p.id} className="flex">
                <ProductCard product={p} comparing={compare.includes(p.id)} back="/" where={where} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mx-auto max-w-6xl px-4 py-14 md:px-6" aria-labelledby="range">
        <h2 id="range" className="text-title font-bold">
          What we sell
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RANGE.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg border border-line bg-raised p-5">
              <Icon aria-hidden className="size-6 text-link" />
              <h3 className="mt-3 text-headline font-bold">{title}</h3>
              <p className="mt-1 text-callout text-ink-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 md:grid-cols-2 md:px-6" aria-label="Ways to buy">
        <div className="rounded-lg border border-line bg-raised p-6">
          <User aria-hidden className="size-6 text-link" />
          <h2 className="mt-3 text-title font-bold">Buying for yourself</h2>
          <p className="mt-2 text-ink-body">Clear prices on laptops, phones, monitors, storage and memory, and regular specials. Check out with an account or as a guest, and pay by bank transfer.</p>
          <Link href="/products" className={buttonClass("ghost", "md", "mt-4 -ml-4")}>
            Start shopping
          </Link>
        </div>
        <div className="rounded-lg bg-forest p-6 text-ink-on-dark">
          <Building2 aria-hidden className="size-6 text-accent" />
          <h2 className="mt-3 text-title font-bold text-white">Buying for a business?</h2>
          <p className="mt-2">Resellers, integrators, government and enterprise buyers get trade prices, fast quotes, tender support and a portal for the whole team.</p>
          <Link href="/sign-up?for=business" className={buttonClass("highlight", "md", "mt-4")}>
            Register for trade prices
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}
