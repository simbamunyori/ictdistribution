import { Building2, Laptop, Network, Server, ShieldCheck, Smartphone, Truck, User } from "lucide-react";
import Link from "next/link";
import { company } from "@/config/app";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { currencyName } from "@/lib/money";
import { currentMarket } from "@/server/markets/current";

const RANGE = [
  { icon: Laptop, title: "Laptops and desktops", text: "Everyday notebooks to workstations, with monitors, SSDs and memory." },
  { icon: Smartphone, title: "Phones", text: "Current flagship models and dependable everyday phones." },
  { icon: Network, title: "Networking", text: "Switches, routers, access points, Wi-Fi extenders and firewalls." },
  { icon: Server, title: "Servers and power", text: "Servers, storage, UPS units, cabling and software licences." },
];

export default async function Home() {
  const { market } = await currentMarket();
  return (
    <SiteFrame>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.3fr_1fr] md:items-center md:px-6 md:py-20">
          <div>
            <p className="kicker text-link">Southern Africa</p>
            <h1 className="mt-3 text-display font-extrabold">{company.tagline}</h1>
            <p className="mt-5 max-w-xl text-headline text-ink-body">
              Laptops, phones, networking, servers and software for homes and businesses in {market.name}, priced in {currencyName(market.currency, market.locale).toLowerCase()}.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className={buttonClass("primary", "lg")}>
                Create an account
              </Link>
              <Link href="/sign-up?for=business" className={buttonClass("secondary", "lg")}>
                Register your business
              </Link>
            </div>
            <p className="mt-4 text-callout text-ink-muted">The shop opens soon. Create an account now and we&apos;ll let you know.</p>
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
          <p className="mt-2 text-ink-body">Retail prices on laptops, phones, monitors, storage and memory, and regular specials. Check out with an account or as a guest.</p>
          <Link href="/sign-up" className={buttonClass("ghost", "md", "mt-4 -ml-4")}>
            Create an account
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
