import type { RowChange } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { discardPriceListAction } from "@/app/admin/(console)/catalogue-actions";
import { ApplyPriceListForm, ColumnsForm } from "@/components/admin/catalogue-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { PRICE_LIST_FIELDS, PRICE_LIST_FIELD_KEYS, type Cell } from "@/lib/price-list";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { listCurrencies } from "@/server/markets/markets";
import { staffCan } from "@/server/staff/access";
import { columnPreview, getImport } from "@/server/suppliers/price-lists";

export const metadata: Metadata = { title: "Price list" };

const CHANGES: { change: RowChange; label: string; tone: "positive" | "warning" | "negative" | "neutral" }[] = [
  { change: "PRICE_UP", label: "Price up", tone: "warning" },
  { change: "PRICE_DOWN", label: "Price down", tone: "positive" },
  { change: "NEW_OFFER", label: "New offer", tone: "positive" },
  { change: "UNMATCHED", label: "No matching product", tone: "neutral" },
  { change: "MISSING", label: "Missing from the list", tone: "warning" },
  { change: "INVALID", label: "Can't be read", tone: "negative" },
  { change: "UNCHANGED", label: "Unchanged", tone: "neutral" },
];

const cell = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

export default async function PriceListPage({ params, searchParams }: { params: Promise<{ id: string; importId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id, importId }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewSuppliers")) redirect("/admin");
  const canImport = staffCan(role, "importPriceLists");
  const show = CHANGES.some((c) => c.change === q.show) ? (q.show as RowChange) : undefined;
  const data = await getImport(prisma, importId, show).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const imp = data.import;
  if (imp.supplierId !== id) notFound();
  const summary = (imp.summary ?? {}) as Partial<Record<RowChange, number>>;
  const mapping = canImport && imp.file && (imp.status === "NEEDS_COLUMNS" || (imp.status === "READY" && q.columns === "1"));
  const [preview, currencies, categories] = await Promise.all([mapping ? columnPreview(prisma, importId) : null, listCurrencies(prisma), categoryOptions(prisma)]);
  const back = `/admin/suppliers/${id}/imports/${importId}`;

  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/suppliers" className="text-link underline underline-offset-4">
          Suppliers
        </Link>
        {" / "}
        <Link href={`/admin/suppliers/${id}`} className="text-link underline underline-offset-4">
          {imp.supplier.name}
        </Link>
      </p>
      <PageHeader title={imp.filename} lead={`${imp.origin === "schedule" ? "Fetched on schedule" : `Uploaded by ${imp.createdByLabel}`}, ${imp.createdAt.toISOString().slice(0, 16).replace("T", " ")}.`} />

      {preview ? (
        <Card className="mb-6">
          <h2 className="mb-1 text-headline font-bold">Which column is which</h2>
          <p className="mb-4 text-ink-muted">Saved for {imp.supplier.name}, so their next list is read the same way. The part number and the cost are needed; the rest helps.</p>
          {preview.sample.length ? (
            <TableWrap label="The first lines of the file">
              <table className="mb-6 w-full min-w-[40rem] text-caption">
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={`${h}-${i}`} className={th}>
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, r) => (
                    <tr key={r}>
                      {preview.headers.map((_, i) => (
                        <td key={i} className={td}>
                          {cell(row[i])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
          <ColumnsForm
            supplierId={id}
            importId={importId}
            headers={preview.headers}
            fields={PRICE_LIST_FIELD_KEYS.map((k) => ({ key: k, label: PRICE_LIST_FIELDS[k].label, required: PRICE_LIST_FIELDS[k].required }))}
            columns={preview.columns}
            sheets={preview.sheets}
            sheet={preview.sheet}
            headerRow={preview.headerRow}
            currencies={currencies.map((c) => ({ value: c.code, label: c.code }))}
            currency={preview.currency}
          />
        </Card>
      ) : null}

      {imp.status === "NEEDS_COLUMNS" && !preview ? <Alert className="mb-6">This list needs its columns matched by someone who can import price lists.</Alert> : null}

      {imp.status !== "NEEDS_COLUMNS" ? (
        <>
          <nav aria-label="Changes in this list" className="mb-6">
            <ul className="flex flex-wrap gap-2">
              {CHANGES.map((c) => (
                <li key={c.change}>
                  <Link
                    href={show === c.change ? back : `${back}?show=${c.change}`}
                    aria-current={show === c.change ? "true" : undefined}
                    className={cn("block rounded-md border border-line px-3 py-2 text-callout hover:bg-surface", show === c.change && "border-brand bg-surface font-semibold")}
                  >
                    {c.label} <span className="tabular-nums">{summary[c.change] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {imp.status === "READY" ? (
            <Card className="mb-6">
              <h2 className="mb-1 text-headline font-bold">Apply it</h2>
              <p className="mb-4 text-ink-muted">
                {imp.largestMoveBps ? `The largest price move is ${(imp.largestMoveBps / 100).toFixed(1)}%. ` : ""}
                Offers are updated from the list as it compares at the moment you apply, so nothing changed since is undone. Lines that can&apos;t be read are skipped.
              </p>
              {data.newer ? <Alert className="mb-4">A newer list from this supplier has arrived. Review that one instead.</Alert> : null}
              {canImport && !data.newer ? (
                <div className="flex flex-col gap-4">
                  <ApplyPriceListForm supplierId={id} importId={importId} deactivateMissing={imp.supplier.format?.deactivateMissing ?? false} categories={categories} unmatched={summary.UNMATCHED ?? 0} />
                  <div className="flex flex-wrap gap-3 border-t border-line pt-4">
                    <ActionForm action={discardPriceListAction} hidden={{ supplierId: id, importId }} label="Discard this list" confirm="Discard this price list? Nothing changes." />
                    {imp.file ? (
                      <Link href={`${back}?columns=1`} className="self-center text-callout text-link underline underline-offset-4">
                        Match the columns again
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : (
            <Alert tone={imp.status === "APPLIED" ? "positive" : "info"} className="mb-6">
              {imp.status === "APPLIED" ? "Applied" : "Discarded"} {imp.decidedAt ? imp.decidedAt.toISOString().slice(0, 16).replace("T", " ") : ""}
              {imp.decidedByLabel ? `, ${imp.decidedByLabel}` : ""}.
            </Alert>
          )}

          <Card>
            <h2 className="mb-4 text-headline font-bold">{show ? CHANGES.find((c) => c.change === show)!.label : "Every change"}</h2>
            {data.rows.length ? (
              <TableWrap label="Lines in this list">
                <table className="w-full min-w-[48rem] text-callout">
                  <thead>
                    <tr>
                      <th className={th}>Line</th>
                      <th className={th}>Part number</th>
                      <th className={th}>Product</th>
                      <th className={th}>Was</th>
                      <th className={th}>Now</th>
                      <th className={th}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const c = CHANGES.find((x) => x.change === r.change)!;
                      return (
                        <tr key={r.id}>
                          <td className={cn(td, "tabular-nums")}>{r.line || ""}</td>
                          <td className={td}>
                            {r.mpn}
                            {r.supplierSku ? <span className="block text-caption text-ink-muted">Their code {r.supplierSku}</span> : null}
                          </td>
                          <td className={td}>
                            {r.productId ? (
                              <Link href={`/admin/products/${r.productId}`} className="text-link underline underline-offset-4">
                                {[r.brand, r.name].filter(Boolean).join(" ") || "Open"}
                              </Link>
                            ) : (
                              [r.brand, r.name].filter(Boolean).join(" ")
                            )}
                          </td>
                          <td className={cn(td, "tabular-nums")}>{r.previousCostMinor !== null ? formatMoney({ amountMinor: r.previousCostMinor, currency: r.currency }, "en") : ""}</td>
                          <td className={cn(td, "tabular-nums")}>{r.costMinor !== null ? formatMoney({ amountMinor: r.costMinor, currency: r.currency }, "en") : ""}</td>
                          <td className={td}>
                            <Badge tone={c.tone}>{c.label}</Badge>
                            {r.movedBps ? <span className="ml-2 tabular-nums">{(r.movedBps / 100).toFixed(1)}%</span> : null}
                            {r.error ? <span className="block text-caption text-ink-muted">{r.error}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="text-ink-muted">Nothing here.</p>
            )}
            {data.rows.length === 500 ? <p className="mt-3 text-callout text-ink-muted">Showing the first 500. Choose a kind of change above to narrow it down.</p> : null}
          </Card>
        </>
      ) : null}
    </>
  );
}
