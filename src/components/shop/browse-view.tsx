import { Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { browse } from "@/server/catalogue/shop";
import { ProductCard } from "./product-card";

type Result = NonNullable<Awaited<ReturnType<typeof browse>>>;
type Search = Record<string, string | string[] | undefined>;

/** The address for the same search with some parameters changed. */
function hrefWith(path: string, search: Search, change: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (k in change || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  }
  for (const [k, v] of Object.entries(change)) if (v !== null) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** The address without one chosen value. */
function hrefWithout(path: string, search: Search, key: string, value: string | null): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || k === "page") continue;
    for (const x of Array.isArray(v) ? v : [v]) if (!(k === key && (value === null || x === value))) p.append(k, x);
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export function BrowseView({ path, search, result, compare, categoryLinks }: { path: string; search: Search; result: Result; compare: string[]; categoryLinks?: { href: string; label: string; count: number }[] }) {
  const q = typeof search.q === "string" ? search.q : "";
  const back = hrefWith(path, search, {});
  const chosen = [
    ...result.brands.filter((b) => b.chosen).map((b) => ({ label: b.label, href: hrefWithout(path, search, "b", b.value) })),
    ...result.facets.flatMap((f) => [
      ...f.options.filter((o) => o.chosen).map((o) => ({ label: `${f.field.label}: ${o.label}`, href: hrefWithout(path, search, `f.${f.field.key}`, o.value) })),
      ...(f.range?.chosenMin !== undefined ? [{ label: `${f.field.label} from ${f.range.chosenMin}${f.field.unit ? ` ${f.field.unit}` : ""}`, href: hrefWithout(path, search, `min.${f.field.key}`, null) }] : []),
      ...(f.range?.chosenMax !== undefined ? [{ label: `${f.field.label} up to ${f.range.chosenMax}${f.field.unit ? ` ${f.field.unit}` : ""}`, href: hrefWithout(path, search, `max.${f.field.key}`, null) }] : []),
    ]),
  ];
  const hasFilters = result.brands.length > 1 || result.facets.length > 0;
  const sorts = [
    ...(result.terms.length ? [{ value: "relevance", label: "Best match" }] : []),
    { value: "newest", label: "Newest" },
    { value: "name", label: "Name" },
  ];

  const filters = (
    <form action={path} className="flex flex-col gap-6">
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {typeof search.sort === "string" ? <input type="hidden" name="sort" value={search.sort} /> : null}
      {result.brands.length > 1 ? (
        <fieldset>
          <legend className="mb-2 font-semibold text-ink">Brand</legend>
          <div className="flex flex-col gap-1.5">
            {result.brands.map((b) => (
              <label key={b.value} className="flex items-center gap-2 text-callout">
                <input type="checkbox" name="b" value={b.value} defaultChecked={b.chosen} className="size-4 accent-[var(--t-primary)]" />
                {b.label} <span className="text-ink-muted">({b.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {result.facets.map((f) =>
        f.range ? (
          <fieldset key={f.field.key}>
            <legend className="mb-2 font-semibold text-ink">
              {f.field.label}
              {f.field.unit ? ` (${f.field.unit})` : ""}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-caption">
                From
                <input name={`min.${f.field.key}`} inputMode="decimal" placeholder={String(f.range.min)} defaultValue={f.range.chosenMin} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-caption">
                To
                <input name={`max.${f.field.key}`} inputMode="decimal" placeholder={String(f.range.max)} defaultValue={f.range.chosenMax} className={inputClass} />
              </label>
            </div>
          </fieldset>
        ) : (
          <fieldset key={f.field.key}>
            <legend className="mb-2 font-semibold text-ink">{f.field.label}</legend>
            <div className="flex flex-col gap-1.5">
              {f.options.map((o) => (
                <label key={o.value} className={cn("flex items-center gap-2 text-callout", !o.count && !o.chosen && "text-ink-muted")}>
                  <input type="checkbox" name={`f.${f.field.key}`} value={o.value} defaultChecked={o.chosen} className="size-4 accent-[var(--t-primary)]" />
                  {o.label} <span className="text-ink-muted">({o.count})</span>
                </label>
              ))}
            </div>
          </fieldset>
        ),
      )}
      <button type="submit" className={buttonClass("primary", "md")}>
        Show results
      </button>
    </form>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside aria-label="Filters" className="min-w-0">
        <form action={path} role="search" className="mb-6 flex gap-2">
          <label htmlFor="shop-q" className="sr-only">
            Search {result.category ? result.category.name.toLowerCase() : "products"}
          </label>
          <input id="shop-q" name="q" defaultValue={q} placeholder="Search" className={inputClass} />
          <button type="submit" className={buttonClass("secondary", "md", "px-3")} aria-label="Search">
            <Search aria-hidden />
          </button>
        </form>
        {categoryLinks?.length ? (
          <nav aria-label="Categories" className="mb-6">
            <ul className="flex flex-col gap-1 text-callout">
              {categoryLinks.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
                    <span className="text-link underline underline-offset-4">{c.label}</span>
                    <span className="text-ink-muted">{c.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {hasFilters ? (
          <>
            <details className="rounded-lg border border-line p-4 lg:hidden">
              <summary className="flex cursor-pointer items-center gap-2 font-semibold">
                <SlidersHorizontal aria-hidden className="size-4" />
                Filters{chosen.length ? ` (${chosen.length})` : ""}
              </summary>
              <div className="mt-4">{filters}</div>
            </details>
            <div className="hidden lg:block">{filters}</div>
          </>
        ) : null}
      </aside>

      <section aria-labelledby="results" className="min-w-0">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="results" className="text-headline font-bold">
            {result.total} {result.total === 1 ? "product" : "products"}
            {result.terms.length ? ` for “${q}”` : ""}
          </h2>
          <nav aria-label="Sort" className="flex flex-wrap items-center gap-1 text-callout">
            <span className="mr-1 text-ink-muted">Sort by</span>
            {sorts.map((s) => (
              <Link key={s.value} href={hrefWith(path, search, { sort: s.value, page: null })} aria-current={result.sort === s.value ? "true" : undefined} className="rounded-md px-2 py-1 hover:bg-surface aria-[current]:bg-surface aria-[current]:font-semibold">
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        {chosen.length ? (
          <ul className="mb-4 flex flex-wrap gap-2" aria-label="Chosen filters">
            {chosen.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-callout hover:bg-surface">
                  {c.label}
                  <X aria-hidden className="size-3.5" />
                  <span className="sr-only"> (remove)</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={q ? `${path}?q=${encodeURIComponent(q)}` : path} className="inline-flex px-2 py-1 text-callout text-link underline underline-offset-4">
                Clear all
              </Link>
            </li>
          </ul>
        ) : null}
        {result.items.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((p) => (
              <li key={p.id} className="flex">
                <ProductCard product={p} comparing={compare.includes(p.id)} back={back} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-line bg-raised p-6">
            <p className="font-semibold">Nothing matches.</p>
            <p className="mt-1 text-ink-muted">Try fewer words or filters. Ask us for anything you can&apos;t find: we source most ICT products on request.</p>
          </div>
        )}
        {result.pages > 1 ? (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-4 text-callout">
            {result.page > 1 ? (
              <Link href={hrefWith(path, search, { page: String(result.page - 1) })} className="text-link underline underline-offset-4">
                Previous
              </Link>
            ) : null}
            <span className="text-ink-muted">
              Page {result.page} of {result.pages}
            </span>
            {result.page < result.pages ? (
              <Link href={hrefWith(path, search, { page: String(result.page + 1) })} className="text-link underline underline-offset-4">
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
        {result.truncated ? <p className="mt-4 text-callout text-ink-muted">Showing the newest matches. Add a word or a filter to narrow it down.</p> : null}
      </section>
    </div>
  );
}
