import type { Metadata } from "next";
import Link from "next/link";
import { startAgainAction } from "@/app/(site)/assistant-actions";
import { ProductCard } from "@/components/shop/product-card";
import { AskForm, HandoverForm } from "@/components/site/assistant-forms";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/zoned";
import { assistantSettings, chatMessages, chatQuoteLines } from "@/server/assistant/chats";
import { currentChat } from "@/server/assistant/cookie";
import { compareIds } from "@/server/catalogue/compare";
import { cardsBySlug } from "@/server/catalogue/search";
import { prisma } from "@/server/db";
import { shopPrices, shopper, shopWhere } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Ask our assistant", description: "Tell us what you need, such as laptops for a 20 person office within a budget, and get products that fit with their prices, or a quote." };

/** The site assistant: a conversation that finds products by need. */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [s, prices, where, chat, settings, compare] = await Promise.all([shopper(), shopPrices(), shopWhere(), currentChat(), assistantSettings(prisma), compareIds()]);
  const messages = chat ? chatMessages(chat) : [];
  const cards = await cardsBySlug(prisma, [...new Set(messages.flatMap((m) => m.products ?? []))], prices);
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const lines = chat ? chatQuoteLines(chat) : [];
  const business = s.standing !== "retail";
  const last = messages[messages.length - 1];
  return (
    <SiteFrame back="/assistant">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <h1 className="text-title font-bold">Ask our assistant</h1>
        <p className="mt-1 mb-6 max-w-2xl text-ink-muted">
          {business
            ? `Say what your business needs, how many and any budget. It finds products from our range and can turn them into a quote request for ${s.organisation?.name ?? "your business"}.`
            : `Say what you need, how many and any budget. It finds products from our range with their prices, including ${s.market.taxName}.`}
        </p>
        {!settings.enabled ? (
          <Alert tone="info">
            The assistant is off just now.{" "}
            <Link href="/products" className="underline underline-offset-4">
              Search the products
            </Link>{" "}
            or{" "}
            <Link href="/account/quotes/new" className="underline underline-offset-4">
              ask for a quote
            </Link>
            .
          </Alert>
        ) : (
          <div className="flex flex-col gap-6">
            {messages.length ? (
              <ol aria-label="Conversation" className="flex flex-col gap-4">
                {messages.map((m, i) => (
                  <li key={i} className={cn("flex flex-col gap-3", m.role === "user" && "items-end")}>
                    <div className={cn("max-w-[42rem] rounded-lg px-4 py-3 whitespace-pre-line", m.role === "user" ? "bg-surface text-ink" : "border border-line bg-raised")}>
                      <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                      {m.text}
                    </div>
                    {m.products?.length ? (
                      <ul className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {m.products.flatMap((slug) => {
                          const c = bySlug.get(slug);
                          return c ? [
                            <li key={slug} className="flex">
                              <ProductCard product={c} comparing={compare.includes(c.id)} back="/assistant" where={where} />
                            </li>,
                          ] : [];
                        })}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {lines.length ? (
              <section aria-labelledby="quote-draft" className="rounded-lg border border-brand bg-raised p-5">
                <h2 id="quote-draft" className="text-headline font-bold">
                  A quote request, ready to send
                </h2>
                <ul className="mt-2 list-disc pl-5">
                  {lines.map((l, i) => (
                    <li key={i}>
                      {l.quantity} x {l.description}
                    </li>
                  ))}
                </ul>
                <p className="mt-3">
                  <Link href="/account/quotes/new?from=assistant" className={buttonClass("primary", "md")}>
                    Check and send it
                  </Link>
                </p>
                <p className="mt-2 text-callout text-ink-muted">{s.user ? "You can change it before sending." : "You sign in or create an account first, then you can change it before sending."}</p>
              </section>
            ) : null}

            {chat?.status === "HANDED_OVER" ? (
              <Alert tone="positive">Passed to our Sales team{chat.handedOverAt ? ` on ${formatDateTime(chat.handedOverAt, s.market.locale, s.market.timeZone)}` : ""}. They reply to {chat.handoverEmail}.</Alert>
            ) : (
              <>
                <AskForm key={chat?.id ?? "new"} start={messages.length ? "" : (sp.q ?? "").slice(0, 500)} first={!messages.length} />
                {chat ? (
                  <details open={Boolean(last?.offerSales)} className="rounded-lg border border-line bg-raised p-5">
                    <summary className="cursor-pointer font-semibold">Rather talk to a person?</summary>
                    <p className="mt-2 mb-4 text-ink-muted">Leave your details and our Sales team will read this conversation and get back to you.</p>
                    <HandoverForm name={s.user?.name ?? ""} email={s.user?.email ?? ""} />
                  </details>
                ) : null}
              </>
            )}

            {chat ? (
              <form action={startAgainAction}>
                <Button type="submit" variant="secondary" size="sm">
                  Start again
                </Button>
              </form>
            ) : null}
            <p className="text-caption text-ink-muted">The assistant suggests products from our range and can be wrong. Check the product page before you buy. We keep the conversation so our Sales team can help.</p>
          </div>
        )}
      </div>
    </SiteFrame>
  );
}
