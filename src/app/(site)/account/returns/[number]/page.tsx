import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withdrawReturnAction } from "@/app/(site)/account/portal-actions";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerReturn, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, RETURN_STATUS_TONE } from "@/server/portal/returns";
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
    ["Settled", r.closedAt],
  ] as const);
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
          <ul className="mt-4 list-disc pl-5">
            {r.lines.map((l) => (
              <li key={l.id}>
                {l.quantity} x {l.orderLine.description}
                {l.orderLine.mpn ? <span className="text-ink-muted">, part {l.orderLine.mpn}</span> : null}
              </li>
            ))}
          </ul>
          {r.note ? (
            <div className="mt-4 rounded-md bg-surface p-4">
              <p className="text-caption font-semibold text-ink-muted uppercase">From us</p>
              <p className="mt-1 whitespace-pre-line">{r.note}</p>
            </div>
          ) : null}
        </Card>
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
