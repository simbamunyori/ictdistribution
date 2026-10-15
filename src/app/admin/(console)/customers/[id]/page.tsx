import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { organisationTypeAction } from "@/app/admin/(console)/actions";
import { removeCustomerPriceAction } from "@/app/admin/(console)/business-actions";
import { setAccountCodeAction } from "@/app/admin/(console)/finance-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { ApproveForm, CreditDecisionForm, CreditTermsForm, CustomerPriceForm, RejectForm } from "@/components/admin/business-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { accountCodeFrom } from "@/lib/accounting-export";
import { cn } from "@/lib/cn";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/zoned";
import { creditPosition, MAX_TERMS_DAYS } from "@/server/accounts/credit";
import { listMembers } from "@/server/accounts/organisations";
import { DOCUMENT_KIND_LABEL, VERIFICATION_LABEL } from "@/server/accounts/verification";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { openInvoices } from "@/server/finance/reminders";
import { customerPricesFor } from "@/server/pricing/customer-prices";
import { listCustomerTypes, ORGANISATION_TYPES } from "@/server/pricing/customer-types";
import { ORG_ROLE_LABEL } from "@/server/org/access";
import { orderStateText } from "@/server/shop/orders";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Customer" };

const TONE = { NOT_SUBMITTED: "neutral", PENDING: "warning", APPROVED: "positive", REJECTED: "negative" } as const;
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaff();
  const actor = { userId: session.userId, name: session.user.name, staffRole: session.user.staffRole };
  if (!staffCan(actor, "viewCustomers")) redirect("/admin");
  const { id } = await params;
  const org = await prisma.organisation.findUnique({
    where: { id },
    include: {
      type: true,
      market: true,
      documents: { select: { id: true, kind: true, filename: true, size: true, createdAt: true, uploadedByLabel: true }, orderBy: { createdAt: "asc" } },
      creditApplications: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!org) notFound();
  const [types, { members }, position, prices, orders, history, owing] = await Promise.all([
    listCustomerTypes(prisma),
    listMembers(prisma, org.id),
    creditPosition(prisma, org.id),
    customerPricesFor(prisma, org.id),
    prisma.order.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" }, take: 10, include: { market: { select: { locale: true } } } }),
    prisma.auditEvent.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    openInvoices(prisma, new Date(), { organisationId: org.id }),
  ]);
  const { locale, timeZone, currency } = org.market;
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency }, locale);
  const can = {
    verify: staffCan(actor, "verifyCustomers"),
    documents: staffCan(actor, "viewDocuments"),
    type: staffCan(actor, "manageCustomers"),
    prices: staffCan(actor, "manageCustomerPrices"),
    credit: staffCan(actor, "manageCredit"),
    finance: staffCan(actor, "manageFinance"),
  };
  const orgTypes = types.filter((t) => ORGANISATION_TYPES.includes(t.code)).map((t) => ({ value: t.code, label: t.name }));

  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/customers" className="text-link underline underline-offset-4">
          Customers
        </Link>
      </p>
      <PageHeader title={org.name} lead={`${org.type.name}, ${org.market.name}. Joined ${formatDate(org.createdAt, locale, timeZone)}.`} />
      <div className="grid gap-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-headline font-bold">Business check</h2>
            <Badge tone={TONE[org.verification]}>{VERIFICATION_LABEL[org.verification]}</Badge>
          </div>
          {org.verification === "APPROVED" ? (
            <p className="mt-2">
              Approved by {org.verifiedByLabel}
              {org.verifiedAt ? ` on ${formatDate(org.verifiedAt, locale, timeZone)}` : ""}. They buy at {org.type.name} prices.
            </p>
          ) : org.verification === "PENDING" ? (
            <p className="mt-2">Sent for checking{org.submittedAt ? ` on ${formatDateTime(org.submittedAt, locale, timeZone)}` : ""}. Until approved they see Individual prices.</p>
          ) : org.verification === "REJECTED" ? (
            <p className="mt-2">Sent back: {org.verificationNote}</p>
          ) : (
            <p className="mt-2">They have not sent their details yet. Until approved they see Individual prices.</p>
          )}
          <dl className="mt-4 grid gap-4 text-callout sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink-muted">Registration number</dt>
              <dd>{org.registrationNumber || "Not given"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-muted">Tax number</dt>
              <dd>{org.taxNumber || "Not given"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-muted">Registered address</dt>
              <dd className="whitespace-pre-line">{org.address || "Not given"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-muted">Directors</dt>
              <dd className="whitespace-pre-line">{org.directors || "Not given"}</dd>
            </div>
          </dl>
          <h3 className="mt-6 font-bold">Documents</h3>
          {org.documents.length ? (
            <ul className="mt-2 divide-y divide-line">
              {org.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="block font-semibold text-ink">{DOCUMENT_KIND_LABEL[d.kind]}</span>
                    <span className="text-callout text-ink-muted">
                      {d.filename}, {size(d.size)}, from {d.uploadedByLabel}
                    </span>
                  </span>
                  {can.documents ? (
                    <a href={`/admin/documents/${d.id}`} target="_blank" rel="noopener" className="text-callout font-semibold text-link underline underline-offset-4">
                      Open<span className="sr-only"> {DOCUMENT_KIND_LABEL[d.kind]}</span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink-muted">None yet.</p>
          )}
          {can.verify && org.verification === "PENDING" ? (
            <div className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
              <ApproveForm organisationId={org.id} level={org.type.name} />
              <RejectForm organisationId={org.id} approved={false} />
            </div>
          ) : null}
          {can.verify && org.verification === "APPROVED" ? (
            <details className="mt-6 border-t border-line pt-4">
              <summary className="cursor-pointer font-semibold text-link">Withdraw the approval</summary>
              <div className="mt-4">
                <RejectForm organisationId={org.id} approved />
              </div>
            </details>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Price level</h2>
          <p className="mt-1 mb-4 text-callout text-ink-muted">Which level they buy at once approved.</p>
          {can.type ? (
            <ActionForm action={organisationTypeAction} hidden={{ organisationId: org.id }} label="Change">
              <label className="sr-only" htmlFor="type">
                Price level for {org.name}
              </label>
              <select id="type" name="type" defaultValue={org.customerType} className={cn(inputClass, "h-9 w-auto pr-8")}>
                {orgTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </ActionForm>
          ) : (
            <Badge>{org.type.name}</Badge>
          )}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Agreed prices</h2>
          <p className="mt-1 text-callout text-ink-muted">Their price for a product, in {currency} including {org.market.taxName}. It replaces the level&apos;s price; a lower special still wins.</p>
          {prices.length ? (
            <TableWrap label="Agreed prices">
              <table className="mt-3 w-full min-w-[36rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Product</th>
                    <th className={cn(th, "text-right")}>Price</th>
                    <th className={th}>Until</th>
                    <th className={th}>Note</th>
                    {can.prices ? <th className={th}><span className="sr-only">Remove</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.id}>
                      <td className={td}>
                        <span className="font-semibold text-ink">{p.product.name}</span>
                        <span className="block text-caption text-ink-muted">
                          {p.product.brand.name} {p.product.mpn}
                        </span>
                      </td>
                      <td className={cn(td, "text-right font-semibold tabular-nums")}>{formatMoney({ amountMinor: p.priceMinor, currency: p.market.currency }, p.market.locale)}</td>
                      <td className={td}>{p.validUntil ? <>{formatDate(p.validUntil, locale, timeZone)} {p.validUntil < new Date() ? <Badge tone="negative">Ended</Badge> : null}</> : "No end"}</td>
                      <td className={td}>{p.note}</td>
                      {can.prices ? (
                        <td className={td}>
                          <ActionForm action={removeCustomerPriceAction} hidden={{ id: p.id, organisationId: org.id }} label="Remove" variant="ghost" />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-3 text-ink-muted">None.</p>
          )}
          {can.prices ? (
            <div className="mt-6 border-t border-line pt-6">
              <CustomerPriceForm organisationId={org.id} currency={currency} taxName={org.market.taxName} />
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Credit</h2>
          {position.limit === null ? (
            <p className="mt-2">No credit account.</p>
          ) : (
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[
                ["Limit", money(position.limit)],
                ["Owed", money(position.owed)],
                ["Overdue", money(position.overdue)],
                ["Available", money(position.available)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-caption font-semibold text-ink-muted uppercase">{k}</dt>
                  <dd className="text-headline font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {position.onHold ? <Alert className="mt-3">On hold: no new orders on account.</Alert> : null}
          {org.creditApplications.length ? (
            <>
              <h3 className="mt-6 font-bold">Applications</h3>
              <ul className="mt-2 divide-y divide-line">
                {org.creditApplications.map((a) => (
                  <li key={a.id} className="py-3">
                    <p className="font-semibold">
                      {money(a.requestedLimitMinor)} on {a.requestedTermsDays} days <Badge tone={a.status === "PENDING" ? "warning" : a.status === "APPROVED" ? "positive" : "neutral"}>{a.status === "PENDING" ? "Waiting" : a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Badge>
                    </p>
                    <p className="text-caption text-ink-muted">
                      {a.appliedByLabel}, {formatDate(a.createdAt, locale, timeZone)}
                      {a.decidedByLabel ? `. Decided by ${a.decidedByLabel}` : ""}
                    </p>
                    <p className="mt-1 text-callout whitespace-pre-line">{a.details}</p>
                    {a.decisionNote ? <p className="mt-1 text-callout text-ink-muted">Note: {a.decisionNote}</p> : null}
                    {can.credit && a.status === "PENDING" ? (
                      <div className="mt-4">
                        <CreditDecisionForm applicationId={a.id} organisationId={org.id} currency={currency} maxDays={MAX_TERMS_DAYS} requested={{ limit: toPlainAmount({ amountMinor: a.requestedLimitMinor, currency }), termsDays: String(a.requestedTermsDays) }} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {can.credit && org.verification === "APPROVED" ? (
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="mb-3 font-bold">Set terms directly</h3>
              <CreditTermsForm organisationId={org.id} currency={currency} maxDays={MAX_TERMS_DAYS} values={{ limit: org.creditLimitMinor === null ? "" : toPlainAmount({ amountMinor: org.creditLimitMinor, currency }), termsDays: org.creditTermsDays ? String(org.creditTermsDays) : "30", onHold: org.creditOnHold }} />
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Accounts</h2>
          {owing.length ? (
            <ul className="mt-2 divide-y divide-line text-callout">
              {owing.map((i) => (
                <li key={i.id} className="flex flex-wrap justify-between gap-3 py-2">
                  <a href={`/admin/orders/${i.orderId}/invoice`} className="font-semibold text-link underline underline-offset-4">
                    {i.number}
                  </a>
                  <span>
                    {formatMoney({ amountMinor: i.outstandingMinor, currency: i.currency }, locale)} to pay, due {formatDate(i.dueAt, locale, timeZone)}
                    {i.daysOverdue > 0 ? `, ${i.daysOverdue} ${i.daysOverdue === 1 ? "day" : "days"} late` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">Nothing owed.</p>
          )}
          <p className="mt-3 text-callout">
            <a href={`/admin/customers/${org.id}/statement`} className="font-semibold text-link underline underline-offset-4">
              Download their statement
            </a>{" "}
            for the last three months, as they see it.
          </p>
          {can.finance ? (
            <div className="mt-4 max-w-md">
              <SpecForm action={setAccountCodeAction} hidden={{ organisationId: org.id }} columns={1} fields={[{ kind: "text", id: "accountCode", label: "Account code in the accounting package", defaultValue: org.accountCode, hint: `Empty uses ${accountCodeFrom(org.name)}, made from their name.` }]} submitLabel="Save code" variant="secondary" />
            </div>
          ) : org.accountCode ? (
            <p className="mt-3 text-callout">Account code {org.accountCode}.</p>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">People</h2>
          <ul className="mt-3 divide-y divide-line">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block font-semibold text-ink">{m.user.name}</span>
                  <span className="text-callout break-all text-ink-muted">{m.user.email}</span>
                </span>
                <Badge>{ORG_ROLE_LABEL[m.role]}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        {orders.length ? (
          <Card>
            <h2 className="text-headline font-bold">Recent orders</h2>
            <ul className="mt-3 divide-y divide-line">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold text-link underline underline-offset-4">
                    {o.number}
                  </Link>
                  <span className="flex items-center gap-3 text-callout">
                    {orderStateText(o)}
                    <span className="font-semibold tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency }, o.market.locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="text-headline font-bold">History</h2>
          <ul className="mt-3 divide-y divide-line">
            {history.map((e) => (
              <li key={e.id} className="py-2.5">
                <p className="text-ink">
                  {e.summary}
                  {e.visibleToCustomer ? null : <span className="text-ink-muted"> (staff only)</span>}
                </p>
                <p className="text-caption text-ink-muted">
                  {e.actorLabel}, {formatDateTime(e.createdAt, locale, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
