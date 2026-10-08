import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { advanceReturnAction } from "@/app/admin/(console)/returns-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { WARRANTY_STATE_LABEL, warrantyState } from "@/lib/warranty";
import { formatDate } from "@/lib/zoned";
import { UNIT_STATUS_LABEL } from "@/server/aftersales/units";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { getReturn, RETURN_OUTCOME_LABEL, RETURN_REASON_LABEL, RETURN_STAFF_LABEL, RETURN_STATUS_TONE, RETURN_WANTS_LABEL, returnCredit } from "@/server/portal/returns";
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
  const canCredit = staffCan(role, "issueCreditNotes");
  const hidden = (step: string) => ({ returnId: r.id, step });
  const now = new Date();
  const units = r.lines.flatMap((l) => l.units.map((u) => ({ ...u.unit, description: l.orderLine.description })));
  const credit = returnCredit(r);
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: r.order.currency }, r.order.market.locale);
  const settling = r.status === "RECEIVED" || r.status === "IN_REPAIR";
  const tracking = [{ kind: "text" as const, id: "carrier", label: "Courier" }, { kind: "text" as const, id: "reference", label: "Tracking number" }];
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
          {r.wants && r.wants !== "OTHER" ? <p className="mt-2 font-semibold">Asks for {RETURN_WANTS_LABEL[r.wants].toLowerCase()}.</p> : null}
          <ul className="mt-4 list-disc pl-5">
            {r.lines.map((l) => (
              <li key={l.id}>
                {l.quantity} of {l.orderLine.quantity} x {l.orderLine.description}
                {l.orderLine.mpn ? `, part ${l.orderLine.mpn}` : ""}
                {l.units.length ? (
                  <ul className="mt-1 text-callout">
                    {l.units.map(({ unit: u }) => {
                      const w = warrantyState(u, now);
                      return (
                        <li key={u.id}>
                          Serial{" "}
                          <Link href={`/admin/warranty?q=${encodeURIComponent(u.serial)}`} className="font-mono text-link underline underline-offset-4">
                            {u.serial}
                          </Link>
                          : {UNIT_STATUS_LABEL[u.status].toLowerCase()}, {w === "IN_WARRANTY" && u.endsAt ? `in warranty until ${formatDate(u.endsAt, r.order.market.locale, r.order.market.timeZone)}` : WARRANTY_STATE_LABEL[w].toLowerCase()}
                          {u.replacedBy ? `, replaced by ${u.replacedBy.serial}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
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
            {r.inboundCarrier || r.inboundReference ? (
              <div>
                <dt className="font-semibold text-ink-muted">Coming back with</dt>
                <dd>{[r.inboundCarrier, r.inboundReference].filter(Boolean).join(", ")}</dd>
              </div>
            ) : null}
            {r.repairStartedAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">In repair</dt>
                <dd>
                  {staffWhen(r.repairStartedAt)}
                  {r.supplierReference ? `, their reference ${r.supplierReference}` : ""}
                </dd>
              </div>
            ) : null}
            {r.sentBackAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">Sent back</dt>
                <dd>
                  {staffWhen(r.sentBackAt)}, {[r.outboundCarrier, r.outboundReference].filter(Boolean).join(", ")}
                </dd>
              </div>
            ) : null}
            {r.closedAt ? (
              <div>
                <dt className="font-semibold text-ink-muted">{r.outcome ? RETURN_OUTCOME_LABEL[r.outcome] : "Settled"}</dt>
                <dd>{staffWhen(r.closedAt)}</dd>
              </div>
            ) : null}
            {r.creditNote ? (
              <div>
                <dt className="font-semibold text-ink-muted">Credit note</dt>
                <dd>
                  <a href={`/admin/credit-notes/${encodeURIComponent(r.creditNote.number)}`} className="text-link underline underline-offset-4">
                    {r.creditNote.number}
                  </a>
                  , {money(r.creditNote.totalMinor)}
                </dd>
              </div>
            ) : null}
          </dl>
          {r.supplierReference && !r.repairStartedAt ? <p className="mt-2 text-callout text-ink-muted">Repair reference: {r.supplierReference}</p> : null}
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
            <h2 className="mb-1 text-headline font-bold">Send it for repair</h2>
            <p className="mb-4 text-callout text-ink-muted">When we or the maker repair it. The customer sees the note, never the repairer or their reference.</p>
            <SpecForm action={advanceReturnAction} hidden={hidden("repair")} idPrefix="repair-" columns={1} fields={[{ kind: "text", id: "supplierReference", label: "Repairer's reference (internal)" }, { kind: "textarea", id: "note", label: "Note for the customer (optional)", rows: 2 }]} submitLabel="Mark in repair" pendingLabel="Saving" />
          </Card>
        ) : null}
        {can && settling ? (
          <Card>
            <h2 className="mb-1 text-headline font-bold">Send it back repaired</h2>
            <p className="mb-4 text-callout text-ink-muted">The same serial numbers go back to the customer with their warranty as it was.</p>
            <SpecForm action={advanceReturnAction} hidden={hidden("repaired")} idPrefix="repaired-" fields={[...tracking, { kind: "textarea", id: "note", label: "What was done, for the customer (optional)", rows: 2, wide: true }]} submitLabel="Send back" pendingLabel="Saving" />
          </Card>
        ) : null}
        {can && settling ? (
          <Card>
            <h2 className="mb-1 text-headline font-bold">Send a replacement</h2>
            <p className="mb-4 text-callout text-ink-muted">{units.length ? "Enter the serial number of each new unit. It carries on the warranty of the one it replaces." : "Nothing in this return has a serial number."}</p>
            <SpecForm action={advanceReturnAction} hidden={hidden("replace")} idPrefix="replace-" fields={[...units.map((u) => ({ kind: "text" as const, id: `replace-${u.id}`, label: `New serial for ${u.serial}`, hint: u.description })), ...tracking, { kind: "textarea", id: "note", label: "Note for the customer (optional)", rows: 2, wide: true }]} submitLabel="Send replacement" pendingLabel="Saving" />
          </Card>
        ) : null}
        {settling && canCredit ? (
          <Card>
            <h2 className="mb-1 text-headline font-bold">Credit it</h2>
            <p className="mb-4 text-callout text-ink-muted">{r.order.invoice ? `Issues a credit note for ${money(credit.totalMinor)} against invoice ${r.order.invoice.number}, at the prices charged. If the customer has already paid, record the refund on the order once it is paid back.` : "This order has no invoice yet, so there is nothing to credit."}</p>
            {r.order.invoice ? <SpecForm action={advanceReturnAction} hidden={hidden("credit")} idPrefix="credit-" columns={1} fields={[{ kind: "textarea", id: "note", label: "Why, printed on the credit note (optional)", rows: 2 }]} submitLabel="Issue credit note" pendingLabel="Issuing" confirm={`Issue a credit note for ${money(credit.totalMinor)}?`} /> : null}
          </Card>
        ) : null}
        {can && settling ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Settle it another way</h2>
            <SpecForm action={advanceReturnAction} hidden={hidden("close")} idPrefix="close-" columns={1} fields={[{ kind: "textarea", id: "note", label: "How it was settled, for the customer", hint: "For example, no fault found and sent back.", rows: 3 }]} submitLabel="Settle" pendingLabel="Saving" />
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
