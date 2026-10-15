import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { advanceReturnAction } from "@/app/admin/(console)/returns-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { getReturn, RETURN_REASON_LABEL, RETURN_STAFF_LABEL, RETURN_STATUS_TONE } from "@/server/portal/returns";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Return" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewOrders")) redirect("/admin");
  const r = await getReturn(prisma, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const can = staffCan(role, "manageReturns");
  const hidden = (step: string) => ({ returnId: r.id, step });
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/returns" className="text-link underline underline-offset-4">
          Returns
        </Link>
      </p>
      <PageHeader
        title={`Return ${r.number}`}
        lead={
          <>
            <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STAFF_LABEL[r.status]}</Badge> For order{" "}
            <Link href={`/admin/orders/${r.order.id}`} className="text-link underline underline-offset-4">
              {r.order.number}
            </Link>
            , {r.order.organisation ? `${r.order.organisation.name}, ` : ""}asked by {r.requestedByLabel} {staffWhen(r.createdAt)}.
          </>
        }
      />
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <h2 className="text-headline font-bold">{RETURN_REASON_LABEL[r.reason]}</h2>
          <p className="mt-2 whitespace-pre-line">{r.details}</p>
          <ul className="mt-4 list-disc pl-5">
            {r.lines.map((l) => (
              <li key={l.id}>
                {l.quantity} of {l.orderLine.quantity} x {l.orderLine.description}
                {l.orderLine.mpn ? `, part ${l.orderLine.mpn}` : ""}
              </li>
            ))}
          </ul>
          {r.note ? (
            <div className="mt-4 rounded-md bg-surface p-4">
              <p className="text-caption font-semibold text-ink-muted uppercase">Told the customer</p>
              <p className="mt-1 whitespace-pre-line">{r.note}</p>
            </div>
          ) : null}
          <dl className="mt-4 grid gap-2 text-callout sm:grid-cols-3">
            {r.decidedAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">Answered</dt>
                <dd>
                  {staffWhen(r.decidedAt)} by {r.decidedByLabel}
                </dd>
              </div>
            ) : null}
            {r.receivedAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">Received</dt>
                <dd>{staffWhen(r.receivedAt)}</dd>
              </div>
            ) : null}
            {r.closedAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">Settled</dt>
                <dd>{staffWhen(r.closedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        {can && r.status === "REQUESTED" ? (
          <>
            <Card>
              <h2 className="mb-4 text-headline font-bold">Approve it</h2>
              <SpecForm action={advanceReturnAction} hidden={hidden("approve")} idPrefix="approve-" columns={1} fields={[{ kind: "textarea", id: "note", label: "How to send it back (optional)", hint: "Emailed to the customer, such as where to drop it off or that a courier will collect it.", rows: 3 }]} submitLabel="Approve" pendingLabel="Approving" />
            </Card>
            <Card>
              <h2 className="mb-4 text-headline font-bold">Decline it</h2>
              <SpecForm action={advanceReturnAction} hidden={hidden("decline")} idPrefix="decline-" columns={1} fields={[{ kind: "textarea", id: "note", label: "Why, for the customer", rows: 3 }]} submitLabel="Decline" pendingLabel="Declining" variant="destructive" />
            </Card>
          </>
        ) : null}
        {can && r.status === "APPROVED" ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">The items are back</h2>
            <SpecForm action={advanceReturnAction} hidden={hidden("receive")} idPrefix="receive-" columns={1} fields={[{ kind: "textarea", id: "note", label: "Note for the customer (optional)", rows: 2 }]} submitLabel="Mark received" pendingLabel="Saving" />
            <p className="mt-4 text-callout text-ink-muted">If an item can be sold again, count it into stock on the Stock page.</p>
          </Card>
        ) : null}
        {can && r.status === "RECEIVED" ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Settle it</h2>
            <SpecForm action={advanceReturnAction} hidden={hidden("close")} idPrefix="close-" columns={1} fields={[{ kind: "textarea", id: "note", label: "How it was settled, for the customer", hint: "Refunded, replaced or repaired, with any reference.", rows: 3 }]} submitLabel="Settle" pendingLabel="Saving" />
          </Card>
        ) : null}
        {can && r.status === "APPROVED" ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Decline it after all</h2>
            <SpecForm action={advanceReturnAction} hidden={hidden("decline")} idPrefix="decline-" columns={1} fields={[{ kind: "textarea", id: "note", label: "Why, for the customer", rows: 3 }]} submitLabel="Decline" pendingLabel="Declining" variant="destructive" />
          </Card>
        ) : null}
      </div>
    </>
  );
}
