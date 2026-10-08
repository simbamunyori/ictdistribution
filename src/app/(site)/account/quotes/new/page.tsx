import type { Metadata } from "next";
import { QuoteRequestForm } from "@/components/quotes/quote-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { prisma } from "@/server/db";
import { actorFor } from "@/server/accounts/organisations";
import { chatQuoteLines, quoteText } from "@/server/assistant/chats";
import { currentChat } from "@/server/assistant/cookie";
import { requireCustomer } from "@/server/auth/next";
import { can } from "@/server/org/access";
import { QUOTE_TYPE_DESCRIPTION, QUOTE_TYPE_LABEL } from "@/server/quotes/common";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Ask for a quote" };

export default async function NewQuote({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const fromAssistant = (await searchParams).from === "assistant";
  const session = await requireCustomer(fromAssistant ? "/account/quotes/new?from=assistant" : "/account/quotes/new");
  const [actor, s, chat] = await Promise.all([actorFor(prisma, session), shopper(), fromAssistant ? currentChat() : null]);
  // What the site assistant drafted, to check and send.
  const drafted = chat ? quoteText(chatQuoteLines(chat)) : "";
  const types = (["STANDARD", "RESELLER_PROJECT", "TENDER"] as const).map((t) => ({ value: t, label: QUOTE_TYPE_LABEL[t], hint: QUOTE_TYPE_DESCRIPTION[t] }));
  return (
    <>
      <PageHeader title="Ask for a quote" lead="Tell us what you need. We price what we stock straight away and ask our suppliers about the rest." />
      {actor && !can(actor, "buy") ? (
        <Card>
          <p>Your role doesn&apos;t allow asking for quotes. Ask an Owner or a Buyer on your team.</p>
        </Card>
      ) : (
        <QuoteRequestForm types={types} marketName={s.market.name} canTender={Boolean(actor)} initialText={drafted} />
      )}
    </>
  );
}
