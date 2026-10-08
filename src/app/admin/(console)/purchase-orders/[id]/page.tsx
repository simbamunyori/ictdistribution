import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { approvePoAction, receivedPoAction, sentByHandPoAction, staffConfirmPoAction, staffPoDocumentAction, staffShipPoAction } from "@/app/admin/(console)/procurement-actions";
import { CancelPoForm } from "@/components/admin/procurement-forms";
import { PoConfirmForm, PoDocumentForm, PoShipForm } from "@/components/procurement/po-forms";
import { PoLines } from "@/components/procurement/po-lines";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import { pricingSettings } from "@/server/pricing/rates";
import { DOCUMENT_KIND_LABEL, PO_STATUS_LABEL, PO_STATUS_TONE, WITH_SUPPLIER } from "@/server/procurement/common";
import { getPurchaseOrder, poLink, poWhatsappLink } from "@/server/procurement/purchase-orders";
import { poFormGiven, poFormLines, supplierCanChange } from "@/server/procurement/supplier";
import { staffWhen } from "@/server/quotes/common";
import { appKey } from "@/server/secrets";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewPurchaseOrders")) redirect("/admin");
  const po = await getPurchaseOrder(prisma, id).catch((e) => {
    if (e instanceof DomainError) return null;
    throw e;
  });
  if (!po) notFound();
  const canManage = staffCan(role, "managePurchaseOrders");
  const base = (await pricingSettings(prisma)).baseCurrency;
  const money = (n: bigint, currency = po.currency) => formatMoney({ amountMinor: n, currency }, company.staffLocale);
  const reasons = po.reviewReasons ? po.reviewReasons.split("\n") : [];
  const appUrl = env().APP_URL;
  const whatsapp = po.status === "TO_SEND_BY_HAND" ? poWhatsappLink(po, po.supplier, po.lines, appKey(), appUrl) : null;
  const hidden = { poId: po.id };
  const lines = poFormLines(po);
  const given = poFormGiven(po);
  const history = [
    po.sentAt ? `Sent ${staffWhen(po.sentAt)}${po.approvedByLabel ? `, approved by ${po.approvedByLabel}` : ", by itself"}` : "",
    po.confirmedAt ? `Confirmed ${staffWhen(po.confirmedAt)}${po.supplierReference ? `, their reference ${po.supplierReference}` : ""}${po.expectedShipDate ? `, shipping ${staffWhen(po.expectedShipDate).split(",")[0]}` : ""}` : "",
    po.shippedAt ? `Shipped ${staffWhen(po.shippedAt).split(",")[0]}${po.shippingReference ? `, waybill ${po.shippingReference}` : ""}` : "",
    po.receivedAt ? `Received ${staffWhen(po.receivedAt)}` : "",
    po.cancelledAt ? `Cancelled ${staffWhen(po.cancelledAt)}${po.cancelReason ? `: ${po.cancelReason}` : ""}` : "",
  ].filter(Boolean);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/purchase-orders" className="text-link underline underline-offset-4">
          Purchase orders
        </Link>
      </p>
      <PageHeader
        title={`Purchase order ${po.number}`}
        lead={
          <>
            <Badge tone={PO_STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge> To{" "}
            <Link href={`/admin/suppliers/${po.supplier.id}`} className="text-link underline underline-offset-4">
              {po.supplier.name}
            </Link>{" "}
            for order{" "}
            <Link href={`/admin/orders/${po.order.id}`} className="text-link underline underline-offset-4">
              {po.order.number}
            </Link>
            , made {staffWhen(po.createdAt)}
            {po.channel === "WHATSAPP" ? ", by WhatsApp" : ", by email"}.
          </>
        }
      />
      <div className="flex max-w-5xl flex-col gap-6">
        {po.status === "AWAITING_APPROVAL" && reasons.length ? (
          <Alert tone="warning">
            <span className="font-semibold">Why it waits for approval:</span>
            <ul className="mt-1 list-disc pl-5">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {canManage && (po.status === "AWAITING_APPROVAL" || po.status === "TO_SEND_BY_HAND" || WITH_SUPPLIER.includes(po.status)) ? (
          <Card>
            <h2 className="text-headline font-bold">Next step</h2>
            {po.status === "AWAITING_APPROVAL" ? (
              <>
                <p className="mt-1 mb-4 text-callout text-ink-muted">{po.channel === "EMAIL" ? `Approving emails it to ${po.supplier.email}.` : "Approving readies a WhatsApp message to send."}</p>
                <ActionForm action={approvePoAction} hidden={hidden} label="Approve and send" pendingLabel="Sending" variant="primary" size="md" confirm={`Send purchase order ${po.number} for ${money(po.totalMinor)} to ${po.supplier.name}?`} />
              </>
            ) : null}
            {po.status === "TO_SEND_BY_HAND" ? (
              <>
                <p className="mt-1 mb-4 text-callout text-ink-muted">Send it on WhatsApp with its link, then mark it sent. The supplier confirms it and adds ship dates, serial numbers and their invoice from the link.</p>
                <div className="flex flex-wrap items-start gap-3">
                  {whatsapp ? (
                    <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-md bg-brand px-4 font-semibold text-on-brand">
                      Open in WhatsApp
                    </a>
                  ) : null}
                  <ActionForm action={sentByHandPoAction} hidden={hidden} label="Mark as sent" size="md" />
                </div>
                <p className="mt-3 text-caption break-all text-ink-muted">Supplier link: {poLink(po, appKey(), appUrl)}</p>
              </>
            ) : null}
            {WITH_SUPPLIER.includes(po.status) ? (
              <>
                <p className="mt-1 mb-4 text-callout text-ink-muted">With the supplier. Mark it received when the goods are in our hands.</p>
                <ActionForm action={receivedPoAction} hidden={hidden} label="Mark as received" size="md" />
              </>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-headline font-bold">Lines</h2>
            <a href={`/admin/purchase-orders/${po.id}/pdf`} className="font-semibold text-link underline underline-offset-4">
              The PDF the supplier gets
            </a>
          </div>
          <div className="mt-4">
            <PoLines po={po} />
          </div>
          {po.totalBaseMinor !== null && po.currency !== base ? <p className="mt-2 text-caption text-ink-muted">About {money(po.totalBaseMinor, base)} when made.</p> : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">History</h2>
          {history.length ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-callout">
              {history.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-callout text-ink-muted">Not sent yet.</p>
          )}
          {po.supplierNote ? <p className="mt-3 text-callout whitespace-pre-line">Supplier&apos;s note: {po.supplierNote}</p> : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Files from the supplier</h2>
          {po.documents.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {po.documents.map((d) => (
                <li key={d.id} className="text-callout">
                  <a href={`/admin/purchase-orders/${po.id}/documents/${d.id}`} className="font-semibold text-link underline underline-offset-4">
                    {d.filename}
                  </a>{" "}
                  <span className="text-ink-muted">
                    {DOCUMENT_KIND_LABEL[d.kind]}, from {d.uploadedByLabel}, {staffWhen(d.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-callout text-ink-muted">None yet.</p>
          )}
          {canManage && po.status !== "CANCELLED" ? (
            <div className="mt-4">
              <PoDocumentForm action={staffPoDocumentAction} hidden={hidden} />
            </div>
          ) : null}
        </Card>

        {canManage && supplierCanChange(po.status) && po.status !== "TO_SEND_BY_HAND" ? (
          <>
            <Card>
              <h2 className="text-headline font-bold">Record the supplier&apos;s confirmation</h2>
              <p className="mt-1 mb-4 text-callout text-ink-muted">When they told you by phone, email or WhatsApp instead of on their page.</p>
              <PoConfirmForm action={staffConfirmPoAction} hidden={hidden} lines={lines} given={given} submitLabel="Save confirmation" />
            </Card>
            <Card>
              <h2 className="text-headline font-bold">Record that it shipped</h2>
              <PoShipForm action={staffShipPoAction} hidden={hidden} lines={lines} given={given} />
            </Card>
          </>
        ) : null}

        {canManage && !["SHIPPED", "RECEIVED", "CANCELLED"].includes(po.status) ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Cancel the purchase order</h2>
            <CancelPoForm poId={po.id} withSupplier={WITH_SUPPLIER.includes(po.status)} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
