import { Building2, FileText, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SaveToListForm } from "@/components/account/portal-forms";
import { AddToCart } from "@/components/shop/add-to-cart";
import { leadTimeText, PriceTag } from "@/components/shop/price-tag";
import { CompareToggle, ProductCard, ProductImage } from "@/components/shop/product-card";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { compareIds } from "@/server/catalogue/compare";
import { shopProduct } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { listsFor } from "@/server/portal/lists";
import { portalCan } from "@/server/portal/scope";
import { TRADE_MAX_LINE } from "@/server/shop/cart";
import { formatMoney } from "@/lib/money";
import { shopSettings } from "@/server/shop/settings";
import { shopper, shopPrices, shopWhere } from "@/server/shop/viewer";
import { company } from "@/config/app";
import { breadcrumbJsonLd, jsonLdText, metaDescription, productJsonLd } from "@/lib/seo";
import { env } from "@/server/env";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await shopProduct(prisma, (await params).slug);
  if (!p) return { title: "Not found" };
  const title = `${p.brand.name} ${p.name}`;
  const description = metaDescription(p.summary || p.description || `${title}, part number ${p.mpn}, from ${company.name}.`);
  const image = p.images[0];
  return {
    title,
    description,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: { type: "website", title, description, url: `/products/${p.slug}`, siteName: company.name, ...(image ? { images: [{ url: `/media/${image.id}`, alt: image.alt || title, ...(image.width && image.height ? { width: image.width, height: image.height } : {}) }] } : {}) },
  };
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const prices = await shopPrices();
  const [p, compare, settings, market] = await Promise.all([shopProduct(prisma, slug, prices), compareIds(), shopSettings(prisma), prisma.market.findUniqueOrThrow({ where: { code: prices.market.code }, select: { deliveryEnabled: true, deliveryNote: true, name: true } })]);
  if (!p) notFound();
  const [where, s] = await Promise.all([shopWhere(), shopper()]);
  const v = s.user ? { userId: s.user.id, organisationId: s.organisation?.id ?? null, role: s.organisation?.role ?? null } : null;
  const lists = v && portalCan(v, "buy") ? await listsFor(prisma, v) : null;
  const lead = leadTimeText(p.price?.leadTimeDays ?? null);
  const trade = where.standing === "trade";
  const max = trade ? TRADE_MAX_LINE : Math.min(settings.maxLineQuantity, p.price?.special?.perOrderLimit ?? Infinity, 20);
  const back = `/products/${p.slug}`;
  const [main, ...more] = p.images;
  const c = p.category;
  const site = env().APP_URL;
  const url = `${site}/products/${p.slug}`;
  // For search engines: the retail price only, as a visitor who isn't signed in sees it.
  const structured = [
    productJsonLd({ name: p.name, brand: p.brand.name, mpn: p.mpn, description: p.summary || p.description, url, images: p.images.map((m) => `${site}/media/${m.id}`), category: c.parent ? `${c.parent.name} > ${c.name}` : c.name, price: where.standing === "retail" && p.sellToIndividuals && p.price ? p.price.amount : null, leadTimeDays: p.price?.leadTimeDays ?? null, warrantyMonths: p.warrantyMonths }),
    breadcrumbJsonLd([{ name: "Products", url: `${site}/products` }, ...(c.parent ? [{ name: c.parent.name, url: `${site}/categories/${c.parent.slug}` }] : []), { name: c.name, url: `${site}/categories/${c.slug}` }, { name: `${p.brand.name} ${p.name}`, url }]),
  ];
  return (
    <SiteFrame back={back}>
      {structured.map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(d) }} />
      ))}
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <nav aria-label="Breadcrumb" className="mb-4 text-callout">
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
            <li>
              {" / "}
              <Link href={`/categories/${c.slug}`} className="text-link underline underline-offset-4">
                {c.name}
              </Link>
            </li>
          </ol>
        </nav>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-2">
          <div className="min-w-0">
            <ProductImage image={main ?? null} size="large" className="aspect-[4/3] w-full rounded-lg border border-line" />
            {more.length ? (
              <ul className="mt-3 grid grid-cols-4 gap-2">
                {more.map((m) => (
                  <li key={m.id}>
                    <a href={`/media/${m.id}`} className="block rounded-md border border-line">
                      <ProductImage image={m} className="aspect-square w-full rounded-md" />
                      <span className="sr-only">Open the larger image</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="min-w-0">
            <p className="kicker text-link">{p.brand.name}</p>
            <h1 className="mt-2 text-title font-bold">{p.name}</h1>
            <p className="mt-2 text-callout text-ink-muted">Part number {p.mpn}</p>
            {p.summary ? <p className="mt-4 text-headline text-ink-body">{p.summary}</p> : null}

            <div className="mt-6 rounded-lg border border-line bg-surface p-5">
              {p.price ? (
                <>
                  <PriceTag price={p.price} locale={where.locale} timeZone={where.timeZone} taxName={prices.market.taxName} size="lg" />
                  {p.price.special?.perOrderLimit ? <p className="mt-1 text-caption text-ink-muted">Up to {p.price.special.perOrderLimit} per order at this price.</p> : null}
                  {p.volume.length ? (
                    <table className="mt-4 w-full max-w-xs text-callout">
                      <caption className="mb-1 text-left font-semibold text-ink">Buy more, pay less each</caption>
                      <thead className="sr-only">
                        <tr>
                          <th scope="col">Quantity</th>
                          <th scope="col">Price each</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.volume.map((v) => (
                          <tr key={v.minQuantity} className="border-t border-line">
                            <th scope="row" className="py-1.5 text-left font-normal text-ink-body">
                              {v.minQuantity} or more
                            </th>
                            <td className="py-1.5 text-right font-semibold tabular-nums">{formatMoney(v.unit, where.locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  <div className="mt-4">
                    <AddToCart productId={p.id} withQuantity max={max} />
                  </div>
                  {lists ? (
                    <details className="mt-4 rounded-md border border-line p-3">
                      <summary className="cursor-pointer font-semibold text-link">Save to a list</summary>
                      <div className="mt-3">
                        <SaveToListForm productId={p.id} lists={lists.map((l) => ({ value: l.id, label: l.name }))} back={back} />
                      </div>
                    </details>
                  ) : null}
                </>
              ) : p.sellToIndividuals || trade ? (
                <>
                  <p className="font-semibold text-ink">Not available to order right now.</p>
                  <p className="mt-1 text-callout text-ink-muted">We&apos;re updating its price. Check back soon, or ask us for it.</p>
                </>
              ) : where.standing === "unverified" ? (
                <>
                  <p className="font-semibold text-ink">Trade prices show once we have checked your business.</p>
                  <p className="mt-1 text-callout text-ink-muted">We sell this to registered businesses. Send your company details and documents, and we will check them.</p>
                  <Link href="/account/business" className={buttonClass("primary", "md", "mt-4")}>
                    Your business details
                  </Link>
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink">Sign up as a business to see prices.</p>
                  <p className="mt-1 text-callout text-ink-muted">We sell this to registered businesses, with trade pricing and quotes.</p>
                  <Link href="/sign-up?for=business" className={buttonClass("primary", "md", "mt-4")}>
                    Register your business
                  </Link>
                </>
              )}
              <div className="mt-4">
                <CompareToggle id={p.id} comparing={compare.includes(p.id)} back={back} />
              </div>
            </div>

            <ul className="mt-6 flex flex-col gap-3 text-callout">
              {p.price && (lead || market.deliveryNote) ? (
                <li className="flex items-start gap-3">
                  <Truck aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
                  <span>{[lead, market.deliveryEnabled ? market.deliveryNote : `Collect in ${market.name}.`].filter(Boolean).join(" ")}</span>
                </li>
              ) : null}
              {p.warrantyMonths ? (
                <li className="flex items-start gap-3">
                  <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
                  <span>
                    {p.warrantyMonths}-month warranty{p.warrantyTerms ? `, ${p.warrantyTerms.charAt(0).toLowerCase()}${p.warrantyTerms.slice(1)}` : ""}.
                  </span>
                </li>
              ) : null}
              {p.sellToIndividuals && where.standing === "retail" ? (
                <li className="flex items-start gap-3">
                  <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
                  <span>
                    Buying for a business?{" "}
                    <Link href="/sign-up?for=business" className="text-link underline underline-offset-4">
                      Register for trade prices
                    </Link>
                    .
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {p.specRows.length ? (
              <section aria-labelledby="specs">
                <h2 id="specs" className="text-headline font-bold">
                  Specifications
                </h2>
                <dl className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised">
                  {p.specRows.map((r) => (
                    <div key={r.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-4 py-3 text-callout">
                      <dt className="text-ink-muted">{r.label}</dt>
                      <dd className="font-semibold text-ink">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {p.description ? (
              <section aria-labelledby="about" className="mt-8">
                <h2 id="about" className="text-headline font-bold">
                  About it
                </h2>
                <div className="mt-3 flex flex-col gap-3 text-ink-body">
                  {p.description.split(/\n\s*\n/).map((para, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          {p.datasheets.length ? (
            <section aria-labelledby="files" className="min-w-0">
              <h2 id="files" className="text-headline font-bold">
                Datasheets
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {p.datasheets.map((d) => (
                  <li key={d.id}>
                    <a href={`/media/${d.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3 hover:bg-surface">
                      <FileText aria-hidden className="size-5 shrink-0 text-link" />
                      <span>
                        <span className="block font-semibold text-link underline underline-offset-4">{d.alt}</span>
                        <span className="text-caption text-ink-muted">PDF, {size(d.size)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {p.goesWith.length ? (
          <section aria-labelledby="goes-with" className="mt-12">
            <h2 id="goes-with" className="text-headline font-bold">
              Goes well with
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {p.goesWith.map((x) => (
                <li key={x.id} className="flex">
                  <ProductCard product={x} comparing={compare.includes(x.id)} back={back} where={where} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {p.suggested.length ? (
          <section aria-labelledby="suggested" className="mt-12">
            <h2 id="suggested" className="text-headline font-bold">
              You may also need
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {p.suggested.map((x) => (
                <li key={x.id} className="flex">
                  <ProductCard product={x} comparing={compare.includes(x.id)} back={back} where={where} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </SiteFrame>
  );
}
