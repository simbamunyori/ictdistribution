import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { removeDocumentAction } from "@/app/(site)/account/business-actions";
import { AddDocumentForm, BusinessDetailsForm, SubmitForCheckForm } from "@/components/account/business-forms";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/zoned";
import { actorFor } from "@/server/accounts/organisations";
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, MAX_DOCUMENTS, missingForCheck, VERIFICATION_LABEL } from "@/server/accounts/verification";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { can } from "@/server/org/access";

export const metadata: Metadata = { title: "Business details" };

const TONE = { NOT_SUBMITTED: "neutral", PENDING: "warning", APPROVED: "positive", REJECTED: "negative" } as const;
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function BusinessPage() {
  const session = await requireCustomer("/account/business");
  const actor = await actorFor(prisma, session);
  if (!actor) redirect("/account");
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: actor.organisationId },
    include: { type: true, market: true, documents: { select: { id: true, kind: true, filename: true, size: true, createdAt: true, uploadedByLabel: true }, orderBy: { createdAt: "asc" } } },
  });
  const owner = can(actor, "manageOrganisation");
  const editable = owner && (org.verification === "NOT_SUBMITTED" || org.verification === "REJECTED");
  const missing = missingForCheck(org, org.documents.map((d) => d.kind));
  const kinds = DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] }));

  return (
    <>
      <PageHeader title="Business details" lead={`What we check before ${org.name} sees ${org.type.name.toLowerCase()} prices and can apply for credit.`} />
      <div className="grid gap-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-headline font-bold">Where it is</h2>
            <Badge tone={TONE[org.verification]}>{VERIFICATION_LABEL[org.verification]}</Badge>
          </div>
          {org.verification === "APPROVED" ? (
            <p className="mt-2">
              Approved{org.verifiedAt ? ` on ${formatDate(org.verifiedAt, org.market.locale, org.market.timeZone)}` : ""}. You see {org.type.name.toLowerCase()} prices across the shop.{" "}
              <Link href="/account/credit" className="text-link underline underline-offset-4">
                Credit terms
              </Link>
            </p>
          ) : org.verification === "PENDING" ? (
            <p className="mt-2">We are checking your details and documents. We will email the owners once we have.</p>
          ) : org.verification === "REJECTED" ? (
            <>
              <Alert className="mt-3">We need a change before we can approve {org.name}: {org.verificationNote}</Alert>
              <p className="mt-3">Correct the details or documents below, then send them again.</p>
            </>
          ) : (
            <p className="mt-2">Fill in the company details, add the registration certificate and the tax certificate, then send them for checking.</p>
          )}
          {!owner && org.verification !== "APPROVED" ? <p className="mt-2 text-callout text-ink-muted">The organisation&apos;s owner sends these details.</p> : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Company details</h2>
          <div className="mt-4">
            <BusinessDetailsForm locked={!editable} details={{ name: org.name, registrationNumber: org.registrationNumber ?? "", taxNumber: org.taxNumber ?? "", address: org.address, directors: org.directors }} />
          </div>
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Documents</h2>
          <p className="mt-1 text-callout text-ink-muted">We need the registration certificate and the tax certificate. Add director IDs or proof of address if you have them. Only our staff can open these.</p>
          {org.documents.length ? (
            <ul className="mt-4 divide-y divide-line">
              {org.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-semibold text-ink">{DOCUMENT_KIND_LABEL[d.kind]}</span>
                    <span className="text-callout text-ink-muted">
                      {d.filename}, {size(d.size)}, added by {d.uploadedByLabel}
                    </span>
                  </span>
                  {editable ? <ActionForm action={removeDocumentAction} hidden={{ documentId: d.id }} label="Remove" variant="ghost" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4">No documents yet.</p>
          )}
          {editable && org.documents.length < MAX_DOCUMENTS ? (
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="mb-3 font-bold">Add a document</h3>
              <AddDocumentForm kinds={kinds} />
            </div>
          ) : null}
        </Card>

        {editable ? (
          <Card>
            <h2 className="text-headline font-bold">Send for checking</h2>
            <p className="mt-1 mb-4">{missing.length ? `Add ${missing.join(" and ")} first.` : "Everything we need is here. Once you send it, the details are locked while we check them."}</p>
            <SubmitForCheckForm ready={!missing.length} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
