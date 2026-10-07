import type { Metadata } from "next";
import { confirmPoAction, poDocumentAction, shipPoAction } from "@/app/supplier/actions";
import { PoConfirmForm, PoDocumentForm, PoShipForm } from "@/components/procurement/po-forms";
import { PoLines } from "@/components/procurement/po-lines";
import { Alert } from "@/components/ui/alert";
import { DEFAULT_TIME_ZONE, company } from "@/config/app";
import { formatDate } from "@/lib/zoned";
import { DOCUMENT_KIND_LABEL } from "@/server/procurement/common";
import { poByToken, poFormGiven, poFormLines, poTerms, supplierCanChange } from "@/server/procurement/supplier";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Purchase order", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A supplier's page for one purchase order, opened from the link in our
 * email or WhatsApp message: what we are buying, and where they confirm
 * it, say when it shipped with the serial numbers, and send their
 * invoice and packing list. Nothing about who it is for.
 */
export default async function SupplierPoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const po = await poByToken(prisma, token);
  if (!po) {
    return (
      <>
        <h1 className="text-title font-bold">This link doesn&apos;t work</h1>
        <p className="mt-3">Check you used the whole link from our message, or reply to it and we will send a new one.</p>
      </>
    );
  }
  const terms = await poTerms(prisma);
  const date = (d: Date) => formatDate(d, company.staffLocale, DEFAULT_TIME_ZONE);
  const lines = poFormLines(po);
  const given = poFormGiven(po);
  const open = supplierCanChange(po.status);
  const hidden = { token };
  const base = `/supplier/po/${encodeURIComponent(token)}`;
  return (
    <>
      <p className="text-callout font-semibold text-ink-muted uppercase">Purchase order {po.number}</p>
      <h1 className="mt-1 text-title font-bold">Hello {po.supplier.name}</h1>
      <p className="mt-3">
        {company.name} is ordering the {po.lines.length === 1 ? "item" : "items"} below at the prices shown, in {po.currency}, before tax. Please quote {po.number} on your invoice.
      </p>
      <div className="mt-4">
        {po.status === "CANCELLED" ? <Alert>We cancelled this purchase order{po.cancelReason ? `: ${po.cancelReason}` : "."} Please don&apos;t ship it.</Alert> : null}
        {po.status === "CONFIRMED" ? <Alert tone="positive">You confirmed it{po.expectedShipDate ? `, shipping ${date(po.expectedShipDate)}` : ""}. Tell us here when it ships.</Alert> : null}
        {po.status === "SHIPPED" || po.status === "RECEIVED" ? (
          <Alert tone="positive">
            {po.status === "RECEIVED" ? "We have received it. Thank you." : `Shipped${po.shippedAt ? ` on ${date(po.shippedAt)}` : ""}${po.shippingReference ? `, waybill ${po.shippingReference}` : ""}. Thank you.`}
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="items" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="items" className="text-headline font-bold">
            What we are ordering
          </h2>
          <a href={`${base}/pdf`} className="font-semibold text-link underline underline-offset-4">
            Download as PDF
          </a>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-raised p-5">
          <PoLines po={po} />
        </div>
        {terms.deliverTo || terms.paymentTerms ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {terms.deliverTo ? (
              <div className="rounded-lg border border-line bg-raised p-5">
                <dt className="font-bold">Deliver to</dt>
                <dd className="mt-2 text-callout whitespace-pre-line">{terms.deliverTo}</dd>
              </div>
            ) : null}
            {terms.paymentTerms ? (
              <div className="rounded-lg border border-line bg-raised p-5">
                <dt className="font-bold">Payment terms</dt>
                <dd className="mt-2 text-callout whitespace-pre-line">{terms.paymentTerms}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>

      {open ? (
        <>
          <section aria-labelledby="confirm" className="mt-10">
            <h2 id="confirm" className="text-headline font-bold">
              {po.status === "CONFIRMED" ? "Change your confirmation" : "Confirm the order"}
            </h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">Say when it ships, and how many you can supply if not all of a line.</p>
            <PoConfirmForm action={confirmPoAction} hidden={hidden} lines={lines} given={given} submitLabel={po.status === "CONFIRMED" ? "Save the changes" : "Confirm the order"} />
          </section>
          <section aria-labelledby="ship" className="mt-10">
            <h2 id="ship" className="text-headline font-bold">
              Shipped it?
            </h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">Tell us the day it left you, the waybill and the serial numbers of the units.</p>
            <PoShipForm action={shipPoAction} hidden={hidden} lines={lines} given={given} />
          </section>
        </>
      ) : null}

      <section aria-labelledby="files" className="mt-10">
        <h2 id="files" className="text-headline font-bold">
          Invoice and packing list
        </h2>
        {po.documents.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {po.documents.map((d) => (
              <li key={d.id} className="text-callout">
                <a href={`${base}/documents/${d.id}`} className="font-semibold text-link underline underline-offset-4">
                  {d.filename}
                </a>{" "}
                <span className="text-ink-muted">
                  {DOCUMENT_KIND_LABEL[d.kind]}, sent {date(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-callout text-ink-muted">None sent yet.</p>
        )}
        {po.status !== "CANCELLED" ? (
          <div className="mt-4 rounded-lg border border-line bg-raised p-5">
            <PoDocumentForm action={poDocumentAction} hidden={hidden} />
          </div>
        ) : null}
      </section>
    </>
  );
}
