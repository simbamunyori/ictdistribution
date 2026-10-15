import { FileText } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { customerStatusText, OPEN_STATUSES, QUOTE_TYPE_LABEL } from "@/server/quotes/common";
import type { CustomerQuote } from "@/server/quotes/customer";

const label = "text-caption font-semibold text-ink-muted uppercase";

/** A quote as the customer sees it: our lines and prices, never suppliers, costs or margins. */
export function QuoteView({ quote: q, pdfHref }: { quote: CustomerQuote; pdfHref: string }) {
  const { locale, timeZone } = q.market;
  const money = (amountMinor: bigint | null) => (amountMinor === null ? "" : formatMoney({ amountMinor, currency: q.currency }, locale));
  const open = OPEN_STATUSES.includes(q.status);
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 rounded-lg border border-line bg-raised p-5 sm:grid-cols-4">
        <div>
          <dt className={label}>Status</dt>
          <dd className="mt-1 font-bold">{customerStatusText(q.status)}</dd>
        </div>
        <div>
          <dt className={label}>Asked for</dt>
          <dd className="mt-1">{formatDateTime(q.createdAt, locale, timeZone)}</dd>
        </div>
        <div>
          <dt className={label}>{q.validUntil ? "Valid until" : "Type"}</dt>
          <dd className="mt-1">{q.validUntil ? formatDate(q.validUntil, locale, timeZone) : QUOTE_TYPE_LABEL[q.type]}</dd>
        </div>
        <div>
          <dt className={label}>Total</dt>
          <dd className="mt-1 font-bold tabular-nums">{open || q.totalMinor === null ? "Being priced" : money(q.totalMinor)}</dd>
        </div>
      </dl>

      {open ? (
        <section aria-labelledby="preparing" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="preparing" className="text-headline font-bold">
            We are preparing your quote
          </h2>
          <p className="mt-2">We price what we stock straight away and ask our suppliers about the rest. We email you as soon as it is ready.</p>
          {q.lines.length ? (
            <ul className="mt-4 flex flex-col divide-y divide-line rounded-md border border-line">
              {q.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 px-4 py-2 text-callout">
                  <span>{l.description}</span>
                  <span className="shrink-0 tabular-nums">{l.quantity}</span>
                </li>
              ))}
            </ul>
          ) : q.requestText ? (
            <p className="mt-4 rounded-md bg-surface p-4 text-callout whitespace-pre-line">{q.requestText}</p>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="lines">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="lines" className="text-headline font-bold">
              Lines
            </h2>
            <a href={pdfHref} className="inline-flex items-center gap-2 font-semibold text-link underline underline-offset-4">
              <FileText aria-hidden className="size-4" />
              Download the PDF
            </a>
          </div>
          <div role="region" aria-label="Quote lines" tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-line focus-visible:outline-2 focus-visible:outline-focus">
            <table className="w-full min-w-[34rem] text-left text-callout">
              <caption className="sr-only">Quote lines, prices before {q.taxName}</caption>
              <thead className="bg-surface text-caption text-ink-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Item
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Qty
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Each
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {q.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{l.description}</span>
                      {l.mpn ? <span className="block text-caption text-ink-muted">Part {l.mpn}</span> : null}
                      {l.leadTimeDays ? <span className="block text-caption text-ink-muted">About {l.leadTimeDays} days to deliver</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(l.unitPriceMinor)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(l.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-raised">
                <tr className="border-t border-line">
                  <th scope="row" colSpan={3} className="px-4 py-2 text-right font-normal">
                    Before {q.taxName}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{money(q.subtotalMinor)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} className="px-4 py-2 text-right font-normal">
                    {q.taxName} {q.taxRateBps / 100}%
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{money(q.taxMinor)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} className="px-4 py-2 pb-3 text-right">
                    Total
                  </th>
                  <td className="px-4 py-2 pb-3 text-right font-bold tabular-nums">{money(q.totalMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {!open ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="terms" className="rounded-lg border border-line bg-raised p-5">
            <h2 id="terms" className="font-bold">
              Terms
            </h2>
            <p className="mt-2 text-callout">{q.leadTimeDays ? `Delivered about ${q.leadTimeDays} days after we receive your order and payment.` : "We confirm delivery when you order."}</p>
            <p className="mt-2 text-callout">{q.paymentTerms}</p>
            {q.validUntil ? <p className="mt-2 text-callout">Prices hold until {formatDate(q.validUntil, locale, timeZone)}.</p> : null}
          </section>
          <section aria-labelledby="bank" className="rounded-lg border border-line bg-raised p-5">
            <h2 id="bank" className="font-bold">
              Bank details
            </h2>
            {q.bankDetails ? <p className="mt-2 font-mono text-callout whitespace-pre-line">{`${q.bankDetails}\nReference: ${q.number}`}</p> : <p className="mt-2 text-callout">We send them with your pro forma invoice.</p>}
          </section>
        </div>
      ) : null}

      {(q.customerReference || q.tenderReference) && (
        <section aria-labelledby="refs" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="refs" className="font-bold">
            {q.tenderReference ? "Tender" : "Your reference"}
          </h2>
          <p className="mt-2 text-callout whitespace-pre-line">
            {[q.tenderReference ? `Reference: ${q.tenderReference}` : q.customerReference, q.tenderDeadline ? `Closes ${formatDateTime(q.tenderDeadline, locale, timeZone)}` : "", q.requiredDocuments ? `Documents asked for:\n${q.requiredDocuments}` : ""].filter(Boolean).join("\n")}
          </p>
        </section>
      )}

      {!open && q.includeDocuments ? (
        <section aria-labelledby="documents" className="rounded-lg border border-line bg-raised p-5">
          <h2 id="documents" className="font-bold">
            Datasheets and warranty
          </h2>
          <ul className="mt-3 flex flex-col gap-3 text-callout">
            {q.lines.map((l) => (
              <li key={l.id}>
                <span className="font-semibold">
                  {l.position}. {l.description}
                </span>
                <span className="block text-ink-muted">Warranty: {l.product?.warrantyMonths ? `${l.product.warrantyMonths} months${l.product.warrantyTerms ? `, ${l.product.warrantyTerms}` : ""}` : "as given by the manufacturer"}</span>
                {l.product?.media.map((m) => (
                  <a key={m.id} href={`/media/${m.id}`} className="block text-link underline underline-offset-4">
                    Datasheet: {m.alt || m.filename}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
