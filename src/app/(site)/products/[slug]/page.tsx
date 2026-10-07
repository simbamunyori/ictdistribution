import { Building2, FileText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompareToggle, ProductCard, ProductImage } from "@/components/shop/product-card";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";
import { compareIds } from "@/server/catalogue/compare";
import { shopProduct } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await shopProduct(prisma, (await params).slug);
  if (!p) return { title: "Not found" };
  return { title: `${p.brand.name} ${p.name}`, description: p.summary || `${p.brand.name} ${p.name}, part number ${p.mpn}.` };
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [p, compare] = await Promise.all([shopProduct(prisma, slug), compareIds()]);
  if (!p) notFound();
  const back = `/products/${p.slug}`;
  const [main, ...more] = p.images;
  const c = p.category;
  return (
    <SiteFrame back={back}>
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
              {p.sellToIndividuals ? (
                <>
                  <p className="font-semibold text-ink">Prices and checkout open soon.</p>
                  <p className="mt-1 text-callout text-ink-muted">Create an account and we&apos;ll let you know when you can buy it.</p>
                  <Link href="/sign-up" className={buttonClass("primary", "md", "mt-4")}>
                    Create an account
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
              {p.warrantyMonths ? (
                <li className="flex items-start gap-3">
                  <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
                  <span>
                    {p.warrantyMonths}-month warranty{p.warrantyTerms ? `, ${p.warrantyTerms.charAt(0).toLowerCase()}${p.warrantyTerms.slice(1)}` : ""}.
                  </span>
                </li>
              ) : null}
              {p.sellToIndividuals ? (
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
                  <ProductCard product={x} comparing={compare.includes(x.id)} back={back} />
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
                  <ProductCard product={x} comparing={compare.includes(x.id)} back={back} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </SiteFrame>
  );
}
