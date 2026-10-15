import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { askSuppliersAction, enterSupplierPricesAction, includeDocumentsAction, markSentByHandAction, removeLineAction, repriceQuoteAction, sendQuoteAction } from "@/app/admin/(console)/quote-actions";
import { CancelQuoteForm, QuoteLineForm } from "@/components/admin/quote-forms";
import { SupplierAnswerForm } from "@/components/quotes/supplier-answer-form";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { company } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import { pricingSettings } from "@/server/pricing/rates";
import { OPEN_STATUSES, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, QUOTE_TYPE_LABEL, staffWhen } from "@/server/quotes/common";
import { durationText, getQuote } from "@/server/quotes/staff";
import { answerFormLines, isOpenRequest, supplierMoney, whatsappLink } from "@/server/quotes/suppliers";
import { appKey } from "@/server/secrets";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Quote" };

const REQUEST_STATUS = { SENT: "Sent", TO_SEND_BY_HAND: "To send on WhatsApp", RESPONDED: "Answered", EXPIRED: "No answer by the deadline", CLOSED: "Closed" } as const;
const REQUEST_TONE = { SENT: "neutral", TO_SEND_BY_HAND: "warning", RESPONDED: "positive", EXPIRED: "negative", CLOSED: "neutral" } as const;
const COST_SOURCE = { CATALOGUE: "Catalogue offer", SUPPLIER: "Supplier's answer", STAFF: "Typed by staff" } as const;

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewQuotes")) redirect("/admin");
  const q = await getQuote(prisma, id).catch((e) => {
    if (e instanceof DomainError) return null;
    throw e;
  });
  if (!q) notFound();
  const [categories, base] = await Promise.all([categoryOptions(prisma), pricingSettings(prisma).then((p) => p.baseCurrency)]);
  const { locale, timeZone } = q.market;
  const money = (amountMinor: bigint | null, currency = q.currency) => (amountMinor === null ? "" : formatMoney({ amountMinor, currency }, locale));
  const showCost = staffCan(role, "viewSuppliers");
  const canManage = staffCan(role, "manageQuotes");
  const canAsk = staffCan(role, "enterSupplierPrices");
  const editable = q.status === "REVIEW" || q.status === "WAITING_ON_SUPPLIERS";
  const reasons = q.reviewReasons ? q.reviewReasons.split("\n") : [];
  const e = env();
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/quotes" className="text-link underline underline-offset-4">
          Quotes
        </Link>
      </p>
      <PageHeader
        title={`Quote ${q.number}`}
        lead={
          <>
            <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge> {QUOTE_TYPE_LABEL[q.type]}
            {q.urgent ? ", urgent" : ""}, asked for {formatDateTime(q.createdAt, locale, timeZone)} in {q.market.name}
            {q.sentAt ? `, sent after ${durationText(q.sentAt.getTime() - q.createdAt.getTime())} (${q.sentByLabel})` : OPEN_STATUSES.includes(q.status) ? `, ${durationText(new Date().getTime() - q.createdAt.getTime())} so far` : ""}.
          </>
        }
      />
      <div className="flex max-w-5xl flex-col gap-6">
        <Card>
          <h2 className="text-headline font-bold">Customer</h2>
          <p className="mt-2">
            {q.organisation ? (
              <Link href={`/admin/customers/${q.organisation.id}`} className="font-semibold text-link underline underline-offset-4">
                {q.organisation.name}
              </Link>
            ) : (
              <span className="font-semibold">{q.companyName || "No account"}</span>
            )}
            <span className="block text-callout">
              {q.name}, {q.email}
              {q.phone ? `, ${q.phone}` : ""}
            </span>
            {q.customerReference ? <span className="block text-callout text-ink-muted">Their reference: {q.customerReference}</span> : null}
          </p>
          {q.type === "TENDER" ? (
            <p className="mt-3 text-callout whitespace-pre-line">{[`Tender ${q.tenderReference}`, q.tenderDeadline ? `Closes ${formatDateTime(q.tenderDeadline, locale, timeZone)}` : "", q.requiredDocuments ? `Documents asked for:\n${q.requiredDocuments}` : ""].filter(Boolean).join("\n")}</p>
          ) : null}
          {q.status === "DECLINED" ? <p className="mt-3 text-callout">Declined{q.declineReason ? `: ${q.declineReason}` : "."}</p> : null}
          {q.validUntil ? <p className="mt-3 text-callout">Valid until {formatDateTime(q.validUntil, locale, timeZone)}.</p> : null}
        </Card>

        {q.status === "REVIEW" && reasons.length ? (
          <Alert tone="warning">
            <span className="font-semibold">Why it waits for a check:</span>
            <ul className="mt-1 list-disc pl-5">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {editable && (canManage || canAsk) ? (
          <Card>
            <h2 className="text-headline font-bold">Next step</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">{q.status === "WAITING_ON_SUPPLIERS" ? `Waiting on suppliers until ${q.supplierDeadline ? staffWhen(q.supplierDeadline) : "their deadline"}. It is priced and checked against the rules as soon as the last one answers.` : "Check the lines, then send it. Changes are priced again straight away."}</p>
            <div className="flex flex-wrap items-start gap-3">
              {canManage ? <ActionForm action={sendQuoteAction} hidden={{ quoteId: q.id }} label="Send to the customer" pendingLabel="Sending" variant="primary" size="md" confirm={`Send quote ${q.number} for ${money(q.totalMinor)} to ${q.email}?`} /> : null}
              {canAsk ? <ActionForm action={askSuppliersAction} hidden={{ quoteId: q.id }} label="Ask suppliers about lines without a cost" pendingLabel="Asking" size="md" /> : null}
              {canManage ? <ActionForm action={repriceQuoteAction} hidden={{ quoteId: q.id }} label="Price again" pendingLabel="Pricing" size="md" /> : null}
              {canManage ? <ActionForm action={includeDocumentsAction} hidden={{ quoteId: q.id, include: q.includeDocuments ? "no" : "yes" }} label={q.includeDocuments ? "Leave out datasheets and warranty" : "Add datasheets and warranty"} size="md" /> : null}
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-headline font-bold">Lines</h2>
            {q.subtotalMinor !== null ? (
              <a href={`/admin/quotes/${q.id}/pdf`} className="font-semibold text-link underline underline-offset-4">
                {q.sentAt ? "The PDF sent" : "Preview the PDF"}
              </a>
            ) : null}
          </div>
          <ol className="mt-4 flex flex-col gap-4">
            {q.lines.map((l) => (
              <li key={l.id} className={cn("rounded-lg border border-line p-4", l.flagReason && "border-warning")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {l.position}. {l.quantity} x {l.description}
                    </p>
                    {l.product ? (
                      <p className="text-callout">
                        Our product:{" "}
                        <Link href={`/admin/products/${l.product.id}`} className="text-link underline underline-offset-4">
                          {l.product.brand.name} {l.product.name}
                        </Link>{" "}
                        ({l.product.mpn}), {l.matchConfidence}% sure
                      </p>
                    ) : (
                      <p className="text-callout text-ink-muted">Not a product we list{l.category ? `. Category: ${l.category.name}` : ""}.</p>
                    )}
                    {l.original !== l.description ? <p className="text-caption text-ink-muted">They wrote: {l.original}</p> : null}
                    {l.flagReason ? <p className="mt-1 text-callout font-semibold">Flagged: {l.flagReason}</p> : null}
                  </div>
                  <div className="text-right text-callout tabular-nums">
                    <p className="font-semibold">{l.unitPriceMinor === null ? "No price yet" : `${money(l.unitPriceMinor)} each`}</p>
                    <p>{money(l.lineTotalMinor)}</p>
                    {l.priceOverride !== null ? <p className="text-caption text-ink-muted">Price set by staff</p> : null}
                  </div>
                </div>
                {showCost ? (
                  <div className="mt-3 rounded-md bg-surface p-3 text-callout">
                    <p>
                      Cost: {l.unitCostBaseMinor === null ? "none yet" : `${money(l.unitCostBaseMinor, base)} landed each`}
                      {l.costSource ? `, ${COST_SOURCE[l.costSource]}` : ""}
                      {l.supplier ? ` from ${l.supplier.name}` : ""}
                      {l.leadTimeDays ? `, about ${l.leadTimeDays} days` : ""}.
                    </p>
                    {l.responses.length ? (
                      <ul className="mt-1 text-ink-muted">
                        {l.responses.map((r) => (
                          <li key={r.id}>
                            {r.request.supplier.name}: {r.noOffer ? "can't supply" : `${supplierMoney(r.costMinor, r.currency, locale)} each`}
                            {r.available !== null ? `, ${r.available} available` : ""}
                            {r.leadTimeDays !== null ? `, ${r.leadTimeDays} days` : ""}
                            {r.notes ? `. ${r.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {editable && canManage ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-semibold text-link">Check or change this line</summary>
                    <div className="mt-4 flex flex-col gap-4">
                      <QuoteLineForm
                        quoteId={q.id}
                        lineId={l.id}
                        given={{
                          description: l.description,
                          quantity: String(l.quantity),
                          reference: l.product?.mpn ?? "",
                          categoryId: l.categoryId ?? "",
                          cost: l.costSource === "STAFF" && l.unitCostBaseMinor !== null ? toPlainAmount({ amountMinor: l.unitCostBaseMinor, currency: base }) : "",
                          leadTimeDays: l.costSource === "STAFF" && l.leadTimeDays !== null ? String(l.leadTimeDays) : "",
                          price: l.priceOverride !== null ? toPlainAmount({ amountMinor: l.priceOverride, currency: q.currency }) : "",
                        }}
                        categories={categories}
                        base={base}
                        currency={q.currency}
                        showCost={showCost}
                      />
                      <ActionForm action={removeLineAction} hidden={{ quoteId: q.id, lineId: l.id }} label="Remove this line" pendingLabel="Removing" variant="destructive" confirm={`Remove line ${l.position}?`} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
          {editable && canManage ? (
            <details className="mt-4">
              <summary className="cursor-pointer font-semibold text-link">Add a line</summary>
              <div className="mt-4">
                <QuoteLineForm quoteId={q.id} given={{ description: "", quantity: "1", reference: "", categoryId: "", cost: "", leadTimeDays: "", price: "" }} categories={categories} base={base} currency={q.currency} showCost={showCost} />
              </div>
            </details>
          ) : null}
          {q.subtotalMinor !== null ? (
            <dl className="mt-6 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-callout tabular-nums sm:ml-auto">
              <dt>Before {q.taxName}</dt>
              <dd className="text-right">{money(q.subtotalMinor)}</dd>
              <dt>
                {q.taxName} {q.taxRateBps / 100}%
              </dt>
              <dd className="text-right">{money(q.taxMinor)}</dd>
              <dt className="font-bold">Total</dt>
              <dd className="text-right font-bold">{money(q.totalMinor)}</dd>
              {showCost && q.costBaseMinor !== null ? (
                <>
                  <dt className="mt-2 text-ink-muted">Landed cost, staff only</dt>
                  <dd className="mt-2 text-right text-ink-muted">{money(q.costBaseMinor, base)}</dd>
                  <dt className="text-ink-muted">Margin</dt>
                  <dd className="text-right text-ink-muted">{q.marginBps === null ? "" : `${q.marginBps / 100}%`}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </Card>

        {showCost && q.priceRequests.length ? (
          <Card>
            <h2 className="text-headline font-bold">Supplier requests</h2>
            <p className="mt-1 text-callout text-ink-muted">Suppliers see our request and its lines only, never the customer.</p>
            <ul className="mt-4 flex flex-col gap-4">
              {q.priceRequests.map((r) => {
                const lines = q.lines.filter((l) => r.lineIds.includes(l.id));
                const wa = r.status === "TO_SEND_BY_HAND" ? whatsappLink(r, r.supplier, lines, appKey(), e.APP_URL, company.name) : null;
                const open = isOpenRequest({ status: r.status, quote: q });
                return (
                  <li key={r.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold">
                        {r.supplier.name}, {r.reference}
                        <span className="block text-callout font-normal text-ink-muted">
                          {r.channel === "EMAIL" ? `By email to ${r.supplier.email}` : `On WhatsApp to ${r.supplier.whatsapp}`}, {lines.length} {lines.length === 1 ? "line" : "lines"}, answer by {staffWhen(r.deadline)}
                          {r.respondedAt ? `. Answered ${staffWhen(r.respondedAt)}` : ""}
                        </span>
                      </p>
                      <Badge tone={REQUEST_TONE[r.status]}>{REQUEST_STATUS[r.status]}</Badge>
                    </div>
                    {r.status === "TO_SEND_BY_HAND" && canAsk ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-md border border-line bg-raised px-3 text-callout font-semibold hover:bg-surface">
                            Open in WhatsApp
                          </a>
                        ) : null}
                        <ActionForm action={markSentByHandAction} hidden={{ quoteId: q.id, requestId: r.id }} label="Mark as sent" pendingLabel="Saving" />
                      </div>
                    ) : null}
                    {r.note ? <p className="mt-3 text-callout">Their note: {r.note}</p> : null}
                    {r.replyText ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-callout font-semibold text-link">Their email reply</summary>
                        <p className="mt-2 max-h-80 overflow-auto rounded-md bg-surface p-3 text-callout whitespace-pre-line">{r.replyText}</p>
                      </details>
                    ) : null}
                    {open && canAsk ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-callout font-semibold text-link">Enter their prices</summary>
                        <div className="mt-4">
                          <SupplierAnswerForm action={enterSupplierPricesAction} hidden={{ quoteId: q.id, requestId: r.id }} lines={answerFormLines({ lines, responses: r.responses })} currency={r.supplier.currency} note={r.note} submitLabel="Save their prices" />
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="text-headline font-bold">What they sent</h2>
          {q.requestText ? <p className="mt-3 max-h-96 overflow-auto rounded-md bg-surface p-3 text-callout whitespace-pre-line">{q.requestText}</p> : null}
          {q.fileName ? (
            <p className="mt-3 text-callout">
              <a href={`/admin/quotes/${q.id}/file`} className="font-semibold text-link underline underline-offset-4">
                {q.fileName}
              </a>
            </p>
          ) : null}
          {!q.requestText && !q.fileName ? <p className="mt-3 text-callout text-ink-muted">Nothing beyond the lines above.</p> : null}
        </Card>

        {canManage && [...OPEN_STATUSES, "SENT"].includes(q.status) ? (
          <Card>
            <details>
              <summary className="cursor-pointer font-semibold text-link">Cancel this quote</summary>
              <div className="mt-4">
                <CancelQuoteForm quoteId={q.id} />
              </div>
            </details>
          </Card>
        ) : null}
      </div>
    </>
  );
}
