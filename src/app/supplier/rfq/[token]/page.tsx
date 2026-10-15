import type { Metadata } from "next";
import { answerRfqAction } from "@/app/supplier/actions";
import { SupplierAnswerForm } from "@/components/quotes/supplier-answer-form";
import { Alert } from "@/components/ui/alert";
import { company } from "@/config/app";
import { prisma } from "@/server/db";
import { staffWhen } from "@/server/quotes/common";
import { answerFormLines, isOpenRequest, requestByToken } from "@/server/quotes/suppliers";

export const metadata: Metadata = { title: "Request for price", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A supplier's page for one request for price, opened from the link in
 * our email or WhatsApp message. It shows what we need and nothing about
 * who it is for.
 */
export default async function SupplierRfqPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(prisma, token);
  if (!r) {
    return (
      <>
        <h1 className="text-title font-bold">This link doesn&apos;t work</h1>
        <p className="mt-3">Check you used the whole link from our message, or reply to it and we will send a new one.</p>
      </>
    );
  }
  const open = isOpenRequest(r);
  return (
    <>
      <p className="text-callout font-semibold text-ink-muted uppercase">Request for price {r.reference}</p>
      <h1 className="mt-1 text-title font-bold">Hello {r.supplier.name}</h1>
      <p className="mt-3">
        {company.name} would like your best price for the {r.lines.length === 1 ? "item" : "items"} below, in {r.supplier.currency}, before tax. {open ? `Please answer by ${staffWhen(r.deadline)}.` : ""}
      </p>
      {r.respondedAt && open ? (
        <div className="mt-4">
          <Alert tone="positive">We have your prices. You can change them here until the deadline.</Alert>
        </div>
      ) : null}
      <div className="mt-8">
        {open ? (
          <SupplierAnswerForm action={answerRfqAction} hidden={{ token }} lines={answerFormLines(r)} currency={r.supplier.currency} note={r.note} submitLabel="Send my prices" />
        ) : (
          <div className="rounded-lg border border-line bg-raised p-5">
            <h2 className="font-bold">This request is closed</h2>
            <p className="mt-2 text-callout">Thank you{r.respondedAt ? " for your prices" : ""}. We will send a new request when we need these items again.</p>
          </div>
        )}
      </div>
    </>
  );
}
