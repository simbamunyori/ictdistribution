import Link from "next/link";
import { company } from "@/config/app";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { buttonClass } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { currentSession } from "@/server/auth/next";
import { compareIds } from "@/server/catalogue/compare";
import { shopCategories } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { currentMarket } from "@/server/markets/current";
import { currentTheme } from "@/server/theme";
import { MarketSwitcher } from "./market-switcher";

/** The header and footer every public and account page shares. Phone first. */
export async function SiteFrame({ children, back = "/" }: { children: React.ReactNode; back?: string }) {
  const [{ market, markets }, session, theme, categories, compare] = await Promise.all([currentMarket(), currentSession("CUSTOMER"), currentTheme(), shopCategories(prisma), compareIds()]);
  const shop = categories.filter((c) => c.count);
  const signedIn = session?.stage === "ACTIVE";
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <Link href="/" aria-label={`${company.name} home`} className="rounded-md">
            <Logo />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            <MarketSwitcher current={market} markets={markets} back={back} />
            {signedIn ? (
              <Link href="/account" className={buttonClass("secondary", "sm")}>
                Your account
              </Link>
            ) : (
              <Link href="/sign-in" className={buttonClass("secondary", "sm")}>
                Sign in
              </Link>
            )}
          </nav>
        </div>
        {shop.length ? (
          <nav aria-label="Shop" className="border-t border-line">
            <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 py-1.5 text-callout md:px-4">
              <li>
                <Link href="/products" className="block rounded-md px-2 py-1.5 font-semibold whitespace-nowrap text-ink hover:bg-surface">
                  All products
                </Link>
              </li>
              {shop.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.slug}`} className="block rounded-md px-2 py-1.5 whitespace-nowrap text-ink-body hover:bg-surface hover:text-ink">
                    {c.name}
                  </Link>
                </li>
              ))}
              {compare.length ? (
                <li className="ml-auto">
                  <Link href="/compare" className="block rounded-md px-2 py-1.5 font-semibold whitespace-nowrap text-link hover:bg-surface">
                    Compare ({compare.length})
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="mt-16 border-t border-line bg-forest text-ink-on-dark">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6">
          <div>
            <p className="font-bold text-white">{company.name}</p>
            <p className="mt-2 text-callout">{company.tagline}</p>
          </div>
          <div className="text-callout">
            <p className="font-semibold text-white">Buying for a business?</p>
            <p className="mt-2">
              <Link href="/sign-up?for=business" className="underline underline-offset-4 hover:text-white">
                Register for trade prices
              </Link>
            </p>
          </div>
          <div className="flex flex-col gap-3 text-callout md:items-end">
            <ThemeSwitch current={theme} onDark />
            <p>
              © {new Date().getFullYear()} {env().COMPANY_LEGAL_NAME}. Built and hosted by {company.builtBy}.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
