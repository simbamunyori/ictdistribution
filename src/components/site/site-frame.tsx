import { ChevronDown, LayoutGrid, MessageSquareText, Search, ShoppingCart, Tag, User } from "lucide-react";
import Link from "next/link";
import { company } from "@/config/app";
import { CategoryIcon } from "@/components/shop/category-icon";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { Logo } from "@/components/ui/logo";
import { currentSession } from "@/server/auth/next";
import { compareIds } from "@/server/catalogue/compare";
import { shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { currentMarket } from "@/server/markets/current";
import { currentCartCount } from "@/server/shop/cart-cookie";
import { currentTheme } from "@/server/theme";
import { MarketSwitcher } from "./market-switcher";

const barLink = "flex items-center gap-1.5 rounded-md px-2.5 py-2 whitespace-nowrap hover:bg-surface";

/** The header and footer every public and account page shares. Phone first. */
export async function SiteFrame({ children, back = "/" }: { children: React.ReactNode; back?: string }) {
  const [{ market, markets }, session, theme, categories, compare, inCart] = await Promise.all([currentMarket(), currentSession("CUSTOMER"), currentTheme(), shopCategories(prisma), compareIds(), currentCartCount()]);
  const shop = categories.filter((c) => c.count);
  const signedIn = session?.stage === "ACTIVE";
  const firstName = signedIn ? session.user.name.split(/\s+/)[0] : null;

  const search = (id: string, className: string) => (
    <form action="/products" role="search" className={className}>
      <label htmlFor={id} className="sr-only">
        Search products
      </label>
      <div className="flex w-full overflow-hidden rounded-md bg-raised ring-brand focus-within:ring-2">
        <input id={id} name="q" type="search" placeholder="Search laptops, phones, part numbers" className="h-11 min-w-0 flex-1 bg-raised px-4 text-body text-ink placeholder:text-ink-muted focus:outline-none" />
        <button type="submit" className="flex w-12 shrink-0 items-center justify-center bg-brand text-on-brand hover:bg-brand-hover">
          <Search aria-hidden className="size-5" />
          <span className="sr-only">Search</span>
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-20">
        <div className="bg-panel text-white">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6 md:px-6">
            <Link href="/" aria-label={`${company.name} home`} className="shrink-0 rounded-md">
              <Logo onDark />
            </Link>
            {search("site-q", "hidden flex-1 md:flex")}
            <nav aria-label="Account" className="ml-auto flex items-center gap-1 md:ml-0">
              <Link href={signedIn ? "/account" : "/sign-in"} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
                <User aria-hidden className="size-5 shrink-0" />
                <span className="hidden flex-col leading-tight lg:flex">
                  <span className="text-caption text-ink-on-dark">{firstName ? `Hello, ${firstName}` : "Hello, sign in"}</span>
                  <span className="text-callout font-semibold">Account and orders</span>
                </span>
                <span className="sr-only lg:hidden">{signedIn ? "Your account" : "Sign in"}</span>
              </Link>
              <Link href="/account/quotes/new" className="hidden flex-col rounded-md px-2 py-1.5 leading-tight hover:bg-white/10 xl:flex">
                <span className="text-caption text-ink-on-dark">Buying in volume</span>
                <span className="text-callout font-semibold">Ask for a quote</span>
              </Link>
              <Link href="/cart" className="relative flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
                <span className="relative">
                  <ShoppingCart aria-hidden className="size-6" />
                  {inCart ? (
                    <span className="absolute -top-2 -right-2.5 min-w-5 rounded-full bg-brand px-1 text-center text-caption leading-5 font-bold text-on-brand tabular-nums" aria-hidden>
                      {inCart}
                    </span>
                  ) : null}
                </span>
                <span className="ml-1 hidden text-callout font-semibold sm:inline">Cart</span>
                <span className="sr-only">{inCart ? `, ${inCart} ${inCart === 1 ? "item" : "items"}` : ", empty"}</span>
              </Link>
            </nav>
          </div>
          <div className="px-4 pb-3 md:hidden">{search("site-q-phone", "flex")}</div>
        </div>
        <div className="border-b border-line bg-raised">
          <nav aria-label="Shop" className="mx-auto flex max-w-7xl items-center gap-1 px-2 text-callout md:px-4">
            {shop.length ? (
              <details className="group relative shrink-0">
                <summary className={`${barLink} cursor-pointer list-none font-semibold text-ink [&::-webkit-details-marker]:hidden`}>
                  <LayoutGrid aria-hidden className="size-4" />
                  All categories
                  <ChevronDown aria-hidden className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute left-0 z-30 mt-1 w-[min(44rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-4 shadow-[0_4px_16px_rgb(0_0_0/0.12)]">
                  <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
                    {shop.map((c) => {
                      return (
                        <li key={c.id}>
                          <Link href={`/categories/${c.slug}`} className="flex items-center gap-2 font-semibold text-ink hover:text-link hover:underline hover:underline-offset-4">
                            <CategoryIcon slug={c.slug} className="size-4 text-ink-muted" />
                            {c.name}
                          </Link>
                          {c.children.some((s) => s.count) ? (
                            <ul className="mt-1.5 flex flex-col gap-1 pl-6">
                              {c.children
                                .filter((s) => s.count)
                                .map((s) => (
                                  <li key={s.id}>
                                    <Link href={`/categories/${s.slug}`} className="text-ink-muted hover:text-link hover:underline hover:underline-offset-4">
                                      {s.name}
                                    </Link>
                                  </li>
                                ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <Link href="/products" className="mt-4 inline-block font-semibold text-link underline underline-offset-4">
                    Shop everything
                  </Link>
                </div>
              </details>
            ) : null}
            <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
              <li>
                <Link href="/specials" className={`${barLink} font-semibold text-highlight-ink`}>
                  <Tag aria-hidden className="size-4" />
                  Specials
                </Link>
              </li>
              {shop.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.slug}`} className={`${barLink} text-ink-body hover:text-ink`}>
                    {c.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/assistant" className={`${barLink} font-semibold text-link`}>
                  <MessageSquareText aria-hidden className="size-4" />
                  Ask our assistant
                </Link>
              </li>
              {compare.length ? (
                <li>
                  <Link href="/compare" className={`${barLink} font-semibold text-link`}>
                    Compare ({compare.length})
                  </Link>
                </li>
              ) : null}
            </ul>
            <div className="hidden shrink-0 md:block">
              <MarketSwitcher current={market} markets={markets} back={back} />
            </div>
          </nav>
          <div className="flex justify-end border-t border-line px-2 md:hidden">
            <MarketSwitcher current={market} markets={markets} back={back} />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="mt-16 bg-panel text-ink-on-dark">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 md:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo onDark />
            <p className="mt-4 max-w-xs text-callout">{company.tagline}</p>
            <p className="mt-4 text-callout">
              Selling in {markets.map((m) => m.name).join(", ")}. Prices in {market.currency}, including {market.taxName}.
            </p>
          </div>
          <FooterColumn title="Shop" links={[{ href: "/products", label: "All products" }, { href: "/specials", label: "Specials" }, ...shop.slice(0, 4).map((c) => ({ href: `/categories/${c.slug}`, label: c.name })), { href: "/assistant", label: "Ask our assistant" }]} />
          <FooterColumn
            title="For business"
            links={[
              { href: "/sign-up?for=business", label: "Register for trade prices" },
              { href: "/account/quotes/new", label: "Ask for a quote" },
              { href: "/account/credit", label: "Buying on account" },
              { href: "/account/team", label: "Your team" },
            ]}
          />
          <FooterColumn
            title="Your account"
            links={[
              { href: signedIn ? "/account" : "/sign-in", label: signedIn ? "Your account" : "Sign in" },
              { href: "/account/orders", label: "Orders" },
              { href: "/account/invoices", label: "Invoices" },
              { href: "/account/returns", label: "Returns" },
              { href: "/account/warranty", label: "Warranty" },
            ]}
          />
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-caption sm:flex-row sm:items-center sm:justify-between md:px-6">
            <p>
              © {new Date().getFullYear()} {env().COMPANY_LEGAL_NAME}. Built and hosted by {company.builtBy}.
            </p>
            <ThemeSwitch current={theme} onDark />
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-callout font-semibold text-white">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2 text-callout">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="hover:text-white hover:underline hover:underline-offset-4">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
