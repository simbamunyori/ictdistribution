import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { linkAction, mediaAction, offerAction } from "@/app/admin/(console)/catalogue-actions";
import { DatasheetForm, ImageUploadForm, LinkForm, OfferForm, ProductForm, SpecsForm, type SpecInput } from "@/components/admin/catalogue-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import type { SpecValues } from "@/lib/catalogue";
import { cn } from "@/lib/cn";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { SOURCING_RULE_LABEL } from "@/lib/sourcing";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions, specFieldsOf } from "@/server/catalogue/categories";
import { brandNames, getProduct, STATUS_LABEL } from "@/server/catalogue/products";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { staffCan } from "@/server/staff/access";
import { pricePreview, productSourcing } from "@/server/suppliers/sourcing";

export const metadata: Metadata = { title: "Product" };

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  const canEdit = staffCan(role, "manageCatalogue");
  const canSee = staffCan(role, "viewSuppliers");
  const canBuy = staffCan(role, "manageSuppliers");
  const product = await getProduct(prisma, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const [categories, brands, sourcing, preview, suppliers] = await Promise.all([
    categoryOptions(prisma),
    brandNames(prisma),
    canSee ? productSourcing(prisma, id) : null,
    canSee ? pricePreview(prisma, id) : null,
    canBuy ? prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }) : [],
  ]);
  const specs = product.specs as SpecValues;
  const specFields: SpecInput[] = specFieldsOf(product.category).map((f) => {
    const v = specs[f.key];
    return { key: f.key, label: f.label, kind: f.kind, unit: f.unit, options: f.options, value: v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v) };
  });
  const images = product.media.filter((m) => m.kind === "IMAGE");
  const datasheets = product.media.filter((m) => m.kind === "DATASHEET");
  const offered = new Set(sourcing?.ranked.map((r) => r.offer.supplierId));

  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/products" className="text-link underline underline-offset-4">
          Products
        </Link>
      </p>
      <PageHeader
        title={`${product.brand.name} ${product.name}`}
        lead={
          <>
            {product.mpn}. {STATUS_LABEL[product.status]}.{" "}
            {product.status === "ACTIVE" ? (
              <Link href={`/products/${product.slug}`} className="text-link underline underline-offset-4">
                See it in the shop
              </Link>
            ) : null}
          </>
        }
      />
      {q.created ? (
        <Alert tone="positive" className="mb-6">
          Added as {STATUS_LABEL[product.status].toLowerCase()}. Fill in its specifications, images and suppliers below.
        </Alert>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Details</h2>
        <ProductForm
          readOnly={!canEdit}
          categories={categories}
          brands={brands}
          product={{
            id: product.id,
            name: product.name,
            brand: product.brand.name,
            mpn: product.mpn,
            categoryId: product.categoryId,
            slug: product.slug,
            summary: product.summary,
            description: product.description,
            warrantyMonths: product.warrantyMonths?.toString() ?? "",
            warrantyTerms: product.warrantyTerms,
            sellToIndividuals: product.sellToIndividuals,
            status: product.status,
            sourcingRule: product.sourcingRule ?? "",
            weightKg: product.weightGrams ? String(product.weightGrams / 1000) : "",
            lengthCm: product.lengthMm ? String(product.lengthMm / 10) : "",
            widthCm: product.widthMm ? String(product.widthMm / 10) : "",
            heightCm: product.heightMm ? String(product.heightMm / 10) : "",
          }}
        />
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-headline font-bold">Specifications</h2>
        <p className="mb-4 text-ink-muted">
          From{" "}
          <Link href={`/admin/categories/${product.categoryId}`} className="text-link underline underline-offset-4">
            {product.category.name}
          </Link>
          . Empty ones don&apos;t show in the shop.
        </p>
        <SpecsForm productId={product.id} fields={specFields} readOnly={!canEdit} />
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-headline font-bold">Images</h2>
        <p className="mb-4 text-ink-muted">The first image is the one on product cards.</p>
        {images.length ? (
          <ul className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((m, i) => (
              <li key={m.id} className="flex flex-col gap-3 rounded-md border border-line p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from our own /media route, already resized */}
                <img src={`/media/${m.id}/thumb`} alt={m.alt} width={m.width ?? undefined} height={m.height ?? undefined} className="aspect-[4/3] w-full rounded-sm bg-white object-contain" loading="lazy" />
                <p className="text-caption text-ink-muted">
                  {m.width} x {m.height}, {kb(m.size)}
                </p>
                {canEdit ? (
                  <>
                    <ActionForm action={mediaAction} hidden={{ id: m.id, productId: product.id, op: "text" }} label="Save">
                      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="text-callout font-semibold">What it shows</span>
                        <input name="alt" defaultValue={m.alt} className={inputClass} />
                      </label>
                    </ActionForm>
                    <div className="flex flex-wrap gap-2">
                      {i > 0 ? <ActionForm action={mediaAction} hidden={{ id: m.id, productId: product.id, op: "up" }} label="Move earlier" /> : null}
                      <ActionForm action={mediaAction} hidden={{ id: m.id, productId: product.id, op: "remove" }} label="Remove" variant="destructive" confirm="Remove this image?" />
                    </div>
                  </>
                ) : (
                  <p className="text-callout">{m.alt}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-ink-muted">No images yet.</p>
        )}
        {canEdit ? <ImageUploadForm productId={product.id} /> : null}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Datasheets</h2>
        {datasheets.length ? (
          <ul className="mb-6 flex flex-col gap-3">
            {datasheets.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3">
                <a href={`/media/${m.id}`} className="font-semibold text-link underline underline-offset-4">
                  {m.alt}
                </a>
                <span className="text-callout text-ink-muted">
                  {m.filename}, {kb(m.size)}
                </span>
                {canEdit ? <ActionForm action={mediaAction} hidden={{ id: m.id, productId: product.id, op: "remove" }} label="Remove" variant="destructive" confirm={`Remove ${m.alt}?`} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-ink-muted">No datasheets yet.</p>
        )}
        {canEdit ? <DatasheetForm productId={product.id} /> : null}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-headline font-bold">Goes with</h2>
        <p className="mb-4 text-ink-muted">Products shown together on both pages, such as a laptop and its dock. The shop also suggests items from the categories set on the category page.</p>
        {product.related.length ? (
          <ul className="mb-6 flex flex-col gap-2">
            {product.related.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <Link href={`/admin/products/${r.id}`} className="text-link underline underline-offset-4">
                  {r.name}
                </Link>
                <span className="text-callout text-ink-muted">{r.mpn}</span>
                {r.status !== "ACTIVE" ? <Badge tone="warning">{STATUS_LABEL[r.status]}</Badge> : null}
                {canEdit ? <ActionForm action={linkAction} hidden={{ productId: product.id, otherId: r.id, op: "unlink" }} label="Unlink" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? <LinkForm productId={product.id} /> : null}
      </Card>

      {sourcing ? (
        <Card className="mb-6">
          <h2 className="mb-1 text-headline font-bold">Suppliers</h2>
          <p className="mb-4 text-ink-muted">
            Staff only. Chosen by <strong className="text-ink">{SOURCING_RULE_LABEL[sourcing.rule]}</strong>, set by {sourcing.ruleFrom}. Landed cost is their price plus freight, insurance, duty and clearing, in {sourcing.base}: estimated from our shipments when this product has a weight and the route has history, else the supplier&apos;s allowance.
          </p>
          {sourcing.ranked.length ? (
            <TableWrap label="Supplier offers">
              <table className="w-full min-w-[46rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={th}>Their price</th>
                    <th className={th}>Landed cost</th>
                    <th className={th}>Lead time</th>
                    <th className={th}>Stock</th>
                    <th className={th}>Price date</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcing.ranked.map((r) => (
                    <tr key={r.offer.id}>
                      <td className={td}>
                        <Link href={`/admin/suppliers/${r.offer.supplierId}`} className="font-semibold text-link underline underline-offset-4">
                          {r.offer.supplier.name}
                        </Link>{" "}
                        {r === sourcing.chosen ? <Badge tone="positive">Chosen</Badge> : null}
                        {r.offer.supplier.preferred ? <Badge>Preferred</Badge> : null}
                        {r.unavailable ? <span className="block text-caption text-warning">{r.unavailable}</span> : null}
                      </td>
                      <td className={cn(td, "tabular-nums")}>{formatMoney({ amountMinor: r.offer.costMinor, currency: r.offer.currency }, "en")}</td>
                      <td className={cn(td, "tabular-nums")}>
                        {r.landed ? formatMoney(r.landed, "en") : "Not known"}
                        {(() => {
                          const b = sourcing.breakdown.get(r.offer.id);
                          const m = (n: bigint) => formatMoney({ amountMinor: n, currency: sourcing.base }, "en");
                          return r.landed ? <span className="block text-caption text-ink-muted">{b ? `Freight ${m(b.freight)}, insurance ${m(b.insurance)}, duty ${b.dutyExempt ? "none" : m(b.duty)}, fees ${m(b.fees)}` : `Allowance of ${r.offer.supplier.landedCostBps / 100}%`}</span> : null;
                        })()}
                      </td>
                      <td className={cn(td, "tabular-nums")}>{r.leadTimeDays} days</td>
                      <td className={cn(td, "tabular-nums")}>{r.offer.stock ?? "Not given"}</td>
                      <td className={cn(td, "tabular-nums")}>
                        {r.offer.priceUpdatedAt.toISOString().slice(0, 10)}
                        <span className="block text-caption text-ink-muted">{r.offer.source === "import" ? "Price list" : "Typed"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">No supplier offers this product yet.</p>
          )}
          {canBuy ? (
            <div className="mt-6 flex flex-col gap-4">
              {sourcing.ranked.map((r) => (
                <details key={r.offer.id} className="rounded-md border border-line p-4">
                  <summary className="cursor-pointer font-semibold">Change {r.offer.supplier.name}&apos;s offer</summary>
                  <div className="mt-4 flex flex-col gap-4">
                    <OfferForm
                      productId={product.id}
                      suppliers={[]}
                      readOnly={false}
                      offer={{
                        id: r.offer.id,
                        supplierId: r.offer.supplierId,
                        cost: toPlainAmount({ amountMinor: r.offer.costMinor, currency: r.offer.currency }),
                        supplierSku: r.offer.supplierSku ?? "",
                        leadTimeDays: r.offer.leadTimeDays?.toString() ?? "",
                        moq: String(r.offer.moq),
                        stock: r.offer.stock?.toString() ?? "",
                        active: r.offer.active,
                      }}
                    />
                    <ActionForm action={offerAction} hidden={{ id: r.offer.id, productId: product.id, op: "remove" }} label="Remove this offer" variant="destructive" confirm={`Remove ${r.offer.supplier.name}'s offer?`} />
                  </div>
                </details>
              ))}
              {suppliers.some((s) => !offered.has(s.id)) ? (
                <div className="border-t border-line pt-5">
                  <h3 className="mb-4 font-semibold">Add a supplier&apos;s offer</h3>
                  <OfferForm productId={product.id} readOnly={false} suppliers={suppliers.filter((s) => !offered.has(s.id)).map((s) => ({ value: s.id, label: s.name, currency: s.currency }))} />
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <h2 className="mb-1 text-headline font-bold">What customers would pay</h2>
          <p className="mb-4 text-ink-muted">
            From the landed cost of {formatMoney(preview.cost, "en")}, each price level&apos;s markup and today&apos;s exchange rates. Category markups and specials refine this in later milestones.
          </p>
          <TableWrap label="Prices by customer type and market">
            <table className="w-full min-w-[36rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Customer type</th>
                  {preview.markets.map((m) => (
                    <th key={m.code} className={th}>
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.type}>
                    <td className={cn(td, "font-semibold text-ink")}>{r.type}</td>
                    {r.prices.map((p, i) => (
                      <td key={preview.markets[i].code} className={cn(td, "tabular-nums")}>
                        {p ? formatMoney(p, preview.markets[i].locale) : "No rate"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
    </>
  );
}
