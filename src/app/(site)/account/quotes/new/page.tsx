import type { Metadata } from "next";
import { QuoteRequestForm } from "@/components/quotes/quote-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { prisma } from "@/server/db";
import { actorFor } from "@/server/accounts/organisations";
import { requireCustomer } from "@/server/auth/next";
import { can } from "@/server/org/access";
import { QUOTE_TYPE_DESCRIPTION, QUOTE_TYPE_LABEL } from "@/server/quotes/common";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Ask for a quote" };

export default async function NewQuote() {
  const session = await requireCustomer("/account/quotes/new");
  const [actor, s] = await Promise.all([actorFor(prisma, session), shopper()]);
  const types = (["STANDARD", "RESELLER_PROJECT", "TENDER"] as const).map((t) => ({ value: t, label: QUOTE_TYPE_LABEL[t], hint: QUOTE_TYPE_DESCRIPTION[t] }));
  return (
    <>
      <PageHeader title="Ask for a quote" lead="Tell us what you need. We price what we stock straight away and ask our suppliers about the rest." />
      {actor && !can(actor, "buy") ? (
        <Card>
          <p>Your role doesn&apos;t allow asking for quotes. Ask an Owner or a Buyer on your team.</p>
        </Card>
      ) : (
        <QuoteRequestForm types={types} marketName={s.market.name} canTender={Boolean(actor)} />
      )}
    </>
  );
}
