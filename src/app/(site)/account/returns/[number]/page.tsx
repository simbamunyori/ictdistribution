import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withdrawReturnAction } from "@/app/(site)/account/portal-actions";
import { ReturnTrackingForm } from "@/components/account/portal-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerReturn, RETURN_OUTCOME_LABEL, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, RETURN_STATUS_TONE, RETURN_WANTS_LABEL } from "@/server/portal/returns";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Return" };

export default async function ReturnPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ number }, q] = await Promise.all([params, searchParams]);
  const v = await portalViewer(`/account/returns/${encodeURIComponent(number)}`);
  const r = await customerReturn(prisma, v, number);
  if (!r) notFound();
  const { locale, timeZone } = r.order.market;
  const date = (d: Date) => formatDate(d, locale, timeZone);
  const steps = r.status === "CANCELLED" ? ([["Asked for", r.createdAt], ["Withdrawn", r.updatedAt]] as const) : ([
    ["Asked for", r.createdAt],
    [r.status === "DECLINED" ? "Declined" : "Approved", r.decidedAt],
    ["Back with us", r.receivedAt],
    ...(r.repairStartedAt ? ([["Being repaired", r.repairStartedAt]] as const) : []),
    ...(r.sentBackAt ? ([[r.outcome === "REPLACEMENT" ? "Replacement sent" : "Sent back to you", r.sentBackAt]] as const) : []),
    [r.outcome ? RETURN_OUTCOME_LABEL[r.outcome] : "Settled", r.closedAt],
  ] as const);
  const outbound = [r.outboundCarrier, r.outboundReference ? `tracking ${r.outboundReference}` : ""].filter(Boolean).join(", ");
  const inbound = [r.inboundCarrier, r.inboundReference ? `tracking ${r.inboundReference}` : ""].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader title={`Return ${r.number}`} lead={<>For order <Link href={`/orders/${encodeURIComponent(r.order.number)}`} className="text-link underline underline-offset-4">{r.order.number}</Link>, asked for by {r.requestedByLabel}.</>} />
      {q.sent ? (
        <div role="status" className="mb-6">
          <Alert tone="positive">We have your request and emailed you a copy. Please don&apos;t send anything until we answer.</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-headline font-bold">{RETURN_REASON_LABEL[r.reason]}</h2>
            <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Badge>
          </div>
          <p className="mt-2 whitespace-pre-line">{r.details}</p>
          {r.wants && r.wants !== "OTHER" ? <p className="mt-2 text-callout text-ink-muted">You asked for {RETURN_WANTS_LABEL[r.wants].toLowerCase()}.</p> : null}
          <ul className="mt-4 list-disc pl-5">
            {r.lines.map((l) => (
              <li key={l.id}>
                {l.quantity} x {l.orderLine.description}
                {l.orderLine.mpn ? <span className="text-ink-muted">, part {l.orderLine.mpn}</span> : null}
                {l.units.length ? (
                  <ul className="mt-1 text-callout">
                    {l.units.map(({ unit }) => (
                      <li key={unit.id}>
                        Serial <span className="font-mono">{unit.serial}</span>
                        {unit.replacedBy ? (
                          <>
                            , replaced by <span className="font-mono">{unit.replacedBy.serial}</span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {r.note ? (
            <div className="mt-4 rounded-md bg-surface p-4">
              <p className="text-caption font-semibold text-ink-muted uppercase">From us</p>
              <p className="mt-1 whitespace-pre-line">{r.note}</p>
            </div>
          ) : null}
          {r.creditNote ? (
            <p className="mt-4">
              Credited {formatMoney({ amountMinor: r.creditNote.totalMinor, currency: r.creditNote.currency }, locale)} on{" "}
              <a href={`/credit-notes/${encodeURIComponent(r.creditNote.number)}`} className="font-semibold text-link underline underline-offset-4">
                credit note {r.creditNote.number}
              </a>
              .
            </p>
          ) : null}
          {outbound ? <p className="mt-4">On its way back to you with {outbound}.</p> : null}
        </Card>
        {r.status === "APPROVED" && portalCan(v, "buy") ? (
          <Card>
            <h2 className="text-headline font-bold">Sending it back</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">Write {r.number} on the outside of the parcel. If you use a courier, tell us which and the tracking number so we can look out for it.</p>
            <ReturnTrackingForm number={r.number} carrier={r.inboundCarrier} reference={r.inboundReference} />
          </Card>
        ) : inbound ? (
          <Card>
            <h2 className="text-headline font-bold">Sent to us</h2>
            <p className="mt-1">With {inbound}.</p>
          </Card>
        ) : null}
        <Card>
          <h2 className="text-headline font-bold">Progress</h2>
          <ol className="mt-3 flex flex-col gap-2">
            {steps.map(([label, at]) => (
              <li key={label} className={at ? "text-ink" : "text-ink-muted"}>
                <span className="font-semibold">{label}</span>
                {at ? `: ${date(at)}` : ""}
              </li>
            ))}
          </ol>
          {r.status === "REQUESTED" && portalCan(v, "buy") ? (
            <ActionForm action={withdrawReturnAction} hidden={{ number: r.number }} label="Withdraw this request" variant="destructive" confirm="Withdraw this return request?" className="mt-4" />
          ) : null}
        </Card>
      </div>
    </>
  );
}
