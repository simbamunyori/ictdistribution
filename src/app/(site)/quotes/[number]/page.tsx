import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerQuoteForms } from "@/components/quotes/quote-forms";
import { QuoteView } from "@/components/quotes/quote-view";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/server/db";
import { can } from "@/server/org/access";
import { quoteByToken, quoteForCustomer } from "@/server/quotes/customer";
import { checkoutOptions } from "@/server/shop/orders";
import { formatMoney } from "@/lib/money";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Your quote", robots: { index: false }, referrer: "no-referrer" };

/** A quote, for whoever holds the link from its email, or the signed-in customer it belongs to. */
export default async function QuotePage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ number }, sp, s] = await Promise.all([params, searchParams, shopper()]);
  const token = sp.t ?? "";
  const byLink = token ? await quoteByToken(prisma, number, token) : null;
  const quote = byLink ?? (s.user ? await quoteForCustomer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!quote) notFound();
  const answerable = quote.status === "SENT" && (!quote.validUntil || quote.validUntil.getTime() > new Date().getTime());
  const mayBuy = Boolean(byLink) || !quote.organisationId || Boolean(s.organisation && can({ role: s.organisation.role }, "buy"));
  const choices = answerable && mayBuy ? await acceptChoices(quote) : null;
  const pdfHref = `/quotes/${encodeURIComponent(quote.number)}/pdf${byLink ? `?t=${encodeURIComponent(token)}` : ""}`;
  return (
    <SiteFrame>
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        {sp.requested ? (
          <div role="status" className="mb-6">
            <Alert tone="positive">Thank you. We have your request and have emailed a copy to {quote.email}.</Alert>
          </div>
        ) : null}
        <h1 className="text-title font-bold">Quote {quote.number}</h1>
        {quote.organisation ? <p className="mt-1 text-ink-muted">For {quote.organisation.name}</p> : null}
        <div className="mt-6">
          <QuoteView quote={quote} pdfHref={pdfHref} />
        </div>
        {answerable ? (
          <section aria-labelledby="answer" className="mt-8 rounded-lg border border-line bg-raised p-5">
            <h2 id="answer" className="text-headline font-bold">
              Happy with it?
            </h2>
            {mayBuy ? (
              <>
                <p className="mt-2 mb-4 text-callout">Accept it and it becomes your order, with a pro forma invoice to pay or on your account. Prices hold until the date above.</p>
                <AnswerQuoteForms number={quote.number} token={byLink ? token : ""} choices={choices!} />
              </>
            ) : (
              <p className="mt-2 text-callout">Your role doesn&apos;t allow accepting quotes. Ask an Owner or a Buyer on your team.</p>
            )}
          </section>
        ) : null}
        {quote.status === "ACCEPTED" || quote.status === "DECLINED" ? (
          <div role="status" className="mt-8">
            <Alert tone={quote.status === "ACCEPTED" ? "positive" : "info"}>{quote.status === "ACCEPTED" ? "You accepted this quote. We will send your pro forma invoice and confirm delivery." : "You declined this quote. Ask us any time for a new one."}</Alert>
          </div>
        ) : null}
        <p className="mt-8 text-callout text-ink-muted">
          Questions about this quote? Reply to its email or contact us and quote {quote.number}.
          {s.user ? (
            <>
              {" "}
              <Link href="/account/quotes" className="text-link underline underline-offset-4">
                See all your quotes
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </SiteFrame>
  );
}

/** Delivery, collection and payment the customer can choose when accepting. */
async function acceptChoices(q: NonNullable<Awaited<ReturnType<typeof quoteByToken>>>) {
  const [{ points, bankTransfer, account }, shop] = await Promise.all([checkoutOptions(prisma, q.marketCode, q.organisationId), prisma.shopSettings.findUnique({ where: { id: "global" } })]);
  const total = q.totalMinor === null ? "" : formatMoney({ amountMinor: q.totalMinor, currency: q.currency }, q.market.locale);
  const enough = account && q.totalMinor !== null && account.available >= q.totalMinor;
  return { points: points.map((p) => ({ id: p.id, name: p.name, address: p.address, hours: p.hours })), bankTransfer, account: enough && account.termsDays ? { termsDays: account.termsDays } : null, payDays: shop?.payDays ?? 3, phone: q.phone, total };
}

