import type { ImportStatus, RowChange } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { contactAction, removeSupplierAction } from "@/app/admin/(console)/catalogue-actions";
import { ContactForm, ScheduleForm, SupplierCategoriesForm, SupplierEventForm, SupplierForm, UploadPriceListForm } from "@/components/admin/catalogue-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { countryOptions } from "@/lib/countries";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";
import { EVENT_KIND_LABEL, getSupplier, performance } from "@/server/suppliers/suppliers";

export const metadata: Metadata = { title: "Supplier" };

const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = { NEEDS_COLUMNS: "Needs its columns", READY: "Waiting for review", APPLIED: "Applied", DISCARDED: "Discarded" };
const changes = (summary: unknown) => {
  const s = (summary ?? {}) as Partial<Record<RowChange, number>>;
  const parts = [
    s.PRICE_UP ? `${s.PRICE_UP} up` : "",
    s.PRICE_DOWN ? `${s.PRICE_DOWN} down` : "",
    s.NEW_OFFER ? `${s.NEW_OFFER} new` : "",
    s.UNMATCHED ? `${s.UNMATCHED} unmatched` : "",
    s.MISSING ? `${s.MISSING} missing` : "",
    s.INVALID ? `${s.INVALID} with problems` : "",
  ].filter(Boolean);
  return parts.join(", ") || "No changes";
};

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewSuppliers")) redirect("/admin");
  const canEdit = staffCan(role, "manageSuppliers");
  const canImport = staffCan(role, "importPriceLists");
  const supplier = await getSupplier(prisma, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const [perf, currencies, categories, offers] = await Promise.all([
    performance(prisma, id),
    listCurrencies(prisma),
    categoryOptions(prisma),
    prisma.supplierOffer.findMany({ where: { supplierId: id }, orderBy: [{ active: "desc" }, { priceUpdatedAt: "desc" }], take: 100, include: { product: { select: { id: true, name: true, mpn: true, brand: { select: { name: true } } } } } }),
  ]);
  const f = supplier.format;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/suppliers" className="text-link underline underline-offset-4">
          Suppliers
        </Link>
      </p>
      <PageHeader
        title={supplier.name}
        lead={`${supplier._count.offers} offers. ${perf.onTimePercent === null ? "No deliveries recorded in the last year." : `${perf.onTimePercent}% of ${perf.deliveries} deliveries on time in the last year, ${perf.problems} ${perf.problems === 1 ? "problem" : "problems"}.`}`}
      />
      {q.created ? (
        <Alert tone="positive" className="mb-6">
          Added. Now add who to talk to, what they supply and their price list.
        </Alert>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Details</h2>
        <SupplierForm
          readOnly={!canEdit}
          countries={countryOptions()}
          currencies={currencies.filter((c) => c.enabled || c.code === supplier.currency).map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` }))}
          supplier={{
            id: supplier.id,
            name: supplier.name,
            kind: supplier.kind,
            country: supplier.country,
            currency: supplier.currency,
            email: supplier.email ?? "",
            whatsapp: supplier.whatsapp ?? "",
            phone: supplier.phone ?? "",
            website: supplier.website ?? "",
            portalUrl: supplier.portalUrl ?? "",
            notes: supplier.notes,
            leadTimeDays: String(supplier.leadTimeDays),
            minOrder: supplier.minOrderMinor === null ? "" : toPlainAmount({ amountMinor: supplier.minOrderMinor, currency: supplier.currency }),
            landedCostPercent: String(supplier.landedCostBps / 100),
            freightMode: supplier.freightMode,
            preferred: supplier.preferred,
            active: supplier.active,
          }}
        />
        {supplier.portalUrl || supplier.whatsapp || supplier.email ? (
          <p className="mt-5 flex flex-wrap gap-4 border-t border-line pt-4 text-callout">
            {supplier.email ? (
              <a href={`mailto:${supplier.email}`} className="text-link underline underline-offset-4">
                Email them
              </a>
            ) : null}
            {supplier.whatsapp ? (
              <a href={`https://wa.me/${supplier.whatsapp.replace(/^\+/, "")}`} className="text-link underline underline-offset-4" rel="noreferrer" target="_blank">
                WhatsApp them
              </a>
            ) : null}
            {supplier.portalUrl ? (
              <a href={supplier.portalUrl} className="text-link underline underline-offset-4" rel="noreferrer" target="_blank">
                Open their portal
              </a>
            ) : null}
          </p>
        ) : null}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Contacts</h2>
        {supplier.contacts.length ? (
          <ul className="mb-6 flex flex-col gap-3">
            {supplier.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line p-3">
                <div className="text-callout">
                  <p className="font-semibold text-ink">
                    {c.name}
                    {c.role ? <span className="font-normal text-ink-muted">, {c.role}</span> : null}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-link underline underline-offset-4">
                        {c.email}
                      </a>
                    ) : null}
                    {c.phone ? <span>{c.phone}</span> : null}
                    {c.whatsapp ? (
                      <a href={`https://wa.me/${c.whatsapp.replace(/^\+/, "")}`} className="text-link underline underline-offset-4" rel="noreferrer" target="_blank">
                        WhatsApp {c.whatsapp}
                      </a>
                    ) : null}
                  </p>
                </div>
                {canEdit ? <ActionForm action={contactAction} hidden={{ id: c.id, supplierId: supplier.id, op: "remove" }} label="Remove" confirm={`Remove ${c.name}?`} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-ink-muted">No contacts yet.</p>
        )}
        {canEdit ? <ContactForm supplierId={supplier.id} /> : null}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">What they supply</h2>
        <SupplierCategoriesForm supplierId={supplier.id} options={categories} chosen={supplier.categories.map((c) => c.categoryId)} readOnly={!canEdit} />
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-headline font-bold">Price lists</h2>
        <p className="mb-4 text-ink-muted">
          {f && Object.keys(f.columns as object).length ? "We know how to read their list, so a new one is compared straight away." : "The first list asks which column is which; later lists reuse it."}
        </p>
        {canImport ? <UploadPriceListForm supplierId={supplier.id} /> : null}
        {supplier.imports.length ? (
          <TableWrap label="Recent price lists">
            <table className="mt-6 w-full min-w-[40rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>File</th>
                  <th className={th}>Received</th>
                  <th className={th}>Changes</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {supplier.imports.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>
                      <Link href={`/admin/suppliers/${supplier.id}/imports/${i.id}`} className="font-semibold text-link underline underline-offset-4">
                        {i.filename}
                      </Link>
                    </td>
                    <td className={cn(td, "tabular-nums")}>
                      {i.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      <span className="block text-caption text-ink-muted">{i.origin === "schedule" ? "Fetched on schedule" : `By ${i.createdByLabel}`}</span>
                    </td>
                    <td className={td}>
                      {changes(i.summary)}
                      {i.largestMoveBps ? <span className="block text-caption text-ink-muted">Largest move {(i.largestMoveBps / 100).toFixed(1)}%</span> : null}
                    </td>
                    <td className={td}>
                      <Badge tone={i.status === "READY" || i.status === "NEEDS_COLUMNS" ? "warning" : i.status === "APPLIED" ? "positive" : "neutral"}>{IMPORT_STATUS_LABEL[i.status]}</Badge>
                      {i.decidedByLabel ? <span className="block text-caption text-ink-muted">{i.decidedByLabel}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-1 font-semibold">Fetch on a schedule</h3>
          <p className="mb-4 text-callout text-ink-muted">
            {f?.lastFetchedAt ? `Last fetched ${f.lastFetchedAt.toISOString().slice(0, 16).replace("T", " ")}. ` : ""}
            {f?.lastFetchError ? <span className="font-semibold text-negative">The last fetch failed: {f.lastFetchError}</span> : null}
          </p>
          <ScheduleForm
            supplierId={supplier.id}
            readOnly={!canImport}
            values={{ sourceUrl: f?.sourceUrl ?? "", schedule: f?.schedule ?? "OFF", autoApplyPercent: f?.autoApplyBps === null || f?.autoApplyBps === undefined ? "" : String(f.autoApplyBps / 100), deactivateMissing: f?.deactivateMissing ?? false }}
          />
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Performance record</h2>
        <SupplierEventForm supplierId={supplier.id} today={today} kinds={Object.entries(EVENT_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        {supplier.events.length ? (
          <ul className="mt-6 flex flex-col gap-3 text-callout">
            {supplier.events.map((e) => (
              <li key={e.id} className="border-t border-line pt-3">
                <p>
                  <span className="font-semibold text-ink">{EVENT_KIND_LABEL[e.kind]}</span> <span className="text-ink-muted">{e.occurredAt.toISOString().slice(0, 10)}</span>
                  {e.reference ? <span className="text-ink-muted">, {e.reference}</span> : null}
                </p>
                {e.note ? <p className="mt-1">{e.note}</p> : null}
                <p className="text-caption text-ink-muted">Recorded by {e.recordedByLabel}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-headline font-bold">Their offers</h2>
        {offers.length ? (
          <TableWrap label="Offers">
            <table className="w-full min-w-[40rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Their price</th>
                  <th className={th}>Stock</th>
                  <th className={th}>Price date</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td className={td}>
                      <Link href={`/admin/products/${o.product.id}`} className="text-link underline underline-offset-4">
                        {o.product.brand.name} {o.product.name}
                      </Link>
                      <span className="block text-caption text-ink-muted">
                        {o.product.mpn}
                        {!o.active ? ", switched off" : ""}
                      </span>
                    </td>
                    <td className={cn(td, "tabular-nums")}>{formatMoney({ amountMinor: o.costMinor, currency: o.currency }, "en")}</td>
                    <td className={cn(td, "tabular-nums")}>{o.stock ?? "Not given"}</td>
                    <td className={cn(td, "tabular-nums")}>{o.priceUpdatedAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No offers yet. Import a price list, or add offers on a product&apos;s page.</p>
        )}
      </Card>

      {canEdit ? (
        <Card>
          <h2 className="text-headline font-bold">Remove this supplier</h2>
          <p className="mt-1 mb-4 text-ink-muted">Removes them with their offers and price lists. The audit log keeps the history. To stop buying from them but keep the record, switch them off above instead.</p>
          <ActionForm action={removeSupplierAction} hidden={{ id: supplier.id }} label="Remove supplier" variant="destructive" confirm={`Remove ${supplier.name} and all their offers?`} />
        </Card>
      ) : null}
    </>
  );
}
