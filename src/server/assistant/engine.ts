import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cleanCopy, readNeed } from "@/lib/assistant";
import { secret } from "@/server/secrets";

/**
 * What answers in the site assistant. With ANTHROPIC_API_KEY set, Claude
 * does: it searches the catalogue through a tool that returns only what
 * the shop itself shows the visitor (no supplier, no cost), chooses which
 * products to show, drafts a quote request and offers Sales. Without the
 * key, or when Claude can't be reached, the rules search for what was
 * typed and offer the same next steps. Either way the answer has the same
 * shape, so the page doesn't know which answered.
 */

export interface ProductSummary {
  slug: string;
  brand: string;
  name: string;
  mpn: string;
  category: string;
  summary: string;
  highlights: string[];
  /** The visitor's price as the shop shows it, or null when it is sold on quote. */
  price: string | null;
  priceMinor: bigint | null;
  /** Whether this visitor can put it in the cart. */
  canBuy: boolean;
  leadTime: string | null;
}

export interface SearchInput {
  query: string;
  category?: string | null;
  /** In major units of the visitor's currency. */
  maxPrice?: number | null;
}

export interface Visitor {
  /** retail: an individual or nobody signed in. trade: an approved business. unverified: a business we have not checked yet. */
  standing: "retail" | "trade" | "unverified";
  signedIn: boolean;
  organisation: string | null;
  market: string;
  currency: string;
  taxName: string;
}

export interface EngineInput {
  visitor: Visitor;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
  categories: { slug: string; name: string }[];
  search: (input: SearchInput) => Promise<ProductSummary[]>;
}

export interface EngineOutput {
  text: string;
  /** Products to show as cards, best first. */
  products: string[];
  /** Lines for a quote request, when the visitor should ask for one. */
  quoteLines: { description: string; quantity: number }[] | null;
  /** Offer to pass the conversation to Sales. */
  handover: boolean;
}

export interface AssistantEngine {
  readonly name: string;
  reply(input: EngineInput): Promise<EngineOutput>;
}

const business = (v: Visitor) => v.standing !== "retail";

/** No AI: search for what was typed and offer the next steps. */
export class RulesEngine implements AssistantEngine {
  readonly name = "rules";
  async reply(input: EngineInput): Promise<EngineOutput> {
    const need = readNeed(input.message);
    const found = need.terms.length ? await input.search({ query: need.terms.join(" "), maxPrice: need.maxPrice }) : [];
    const shown = found.slice(0, 6);
    const asBusiness = business(input.visitor);
    const budget = need.maxPrice ? ` within ${input.visitor.currency} ${need.maxPrice.toLocaleString("en")}` : "";
    let text: string;
    if (!need.terms.length) text = "Tell me what you are looking for, such as a laptop for office work, a 24 port switch or a UPS for a server, and any budget or how many you need.";
    else if (!shown.length) text = `I couldn't find a match${budget}. We source most ICT products on request, so ${asBusiness ? "ask us for a quote" : "ask our Sales team"} and we will find it.`;
    else text = `Here ${shown.length === 1 ? "is what matches" : `are ${shown.length} products that match`}${budget}. ${asBusiness ? "Prices for your business are shown where we have them; for more than a few, or anything not listed, ask for a quote." : `Prices include ${input.visitor.taxName}.`}`;
    const quantity = need.quantity ?? 1;
    return {
      text,
      products: shown.map((p) => p.slug),
      quoteLines: asBusiness && need.terms.length ? (shown.length ? shown.slice(0, 3).map((p) => ({ description: `${p.brand} ${p.name} (${p.mpn})`, quantity })) : [{ description: input.message.slice(0, 300), quantity }]) : null,
      handover: !shown.length && need.terms.length > 0,
    };
  }
}

export const MODEL = "claude-opus-5-5";

function system(v: Visitor, categories: { slug: string; name: string }[]): string {
  const who =
    v.standing === "trade"
      ? `an approved business customer (${v.organisation}). They see their business prices. For more than a few units, projects or anything not in the catalogue, draft a quote request.`
      : v.standing === "unverified"
        ? `a business (${v.organisation}) we have not finished checking, so they see individual prices for now. Suggest a quote request for business purchases.`
        : `${v.signedIn ? "a signed-in" : "a"} visitor buying for themselves. Show the retail prices the search gives you, which include ${v.taxName}. Some products are sold to businesses only; for those say a business account can buy them or ask for a quote.`;
  return `You are the product assistant for ICT Distribution Africa, a distributor of laptops, desktops, monitors, phones, printers, networking, servers, storage, power and software. You help people find the right products for their need.

The visitor is ${who} They are in ${v.market} and prices are in ${v.currency}.

How to work:
- Use search_products before recommending anything. Recommend only products it returns, by their exact names. Never invent a product, a price, stock or a delivery date.
- Work out the need first: what it is for, how many, the budget. If something essential is missing, ask one short question, but still show sensible options when you can.
- Then call show_products with the best few, best first, and explain briefly why each fits. Mention the price only as search_products gives it.
- A budget is per unit unless they say otherwise. If nothing fits, say so and show the closest.
- When a business needs several items, quantities or a project, call draft_quote_request with clear lines and quantities. Tell them they can send it with the button below.
- When they want a person, have a question about an order, credit, a complaint, or something you can't answer from the catalogue, call offer_sales.
- We never discuss our suppliers, costs or margins. If asked, say prices come from our own price list.
- Write plainly and briefly, in British English. No exclamation marks, no em dashes, no lists longer than five items. No markdown headings.

Categories (slug: name):
${categories.map((c) => `${c.slug}: ${c.name}`).join("\n")}`;
}

/** Claude, with the rules as a fallback when the call fails. */
export class ClaudeEngine implements AssistantEngine {
  readonly name = "claude";
  private client: Anthropic;
  private rules = new RulesEngine();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }

  async reply(input: EngineInput): Promise<EngineOutput> {
    const out: EngineOutput = { text: "", products: [], quoteLines: null, handover: false };
    const seen = new Set<string>();
    const tools = [
      betaZodTool({
        name: "search_products",
        description: "Search our catalogue. Returns up to 8 products with the visitor's price, whether they can buy it now, its key specifications and lead time. Search with the product type and the specification that matters, such as 'laptop 16GB' or '24 port poe switch'.",
        inputSchema: z.object({
          query: z.string().describe("Words to search for: product type, brand, specification or part number."),
          category: z.string().nullable().optional().describe("A category slug from the list, to search only there."),
          max_price: z.number().nullable().optional().describe("Most the visitor will pay per unit, in their currency."),
        }),
        run: async ({ query, category, max_price }) => {
          const found = await input.search({ query, category: category ?? null, maxPrice: max_price ?? null });
          for (const p of found) seen.add(p.slug);
          if (!found.length) return "No products found. Try other words, a wider category or no price limit.";
          return JSON.stringify(found.map((p) => ({ slug: p.slug, name: `${p.brand} ${p.name}`, part: p.mpn, category: p.category, summary: p.summary.slice(0, 200), specs: p.highlights, price: p.price ?? "Price on quote", can_buy_now: p.canBuy, lead_time: p.leadTime })));
        },
      }),
      betaZodTool({
        name: "show_products",
        description: "Show these products to the visitor as cards with their price and a link, best first. Use slugs from search_products. Call it once per answer.",
        inputSchema: z.object({ slugs: z.array(z.string()).max(6) }),
        run: async ({ slugs }) => {
          out.products = slugs.filter((s) => seen.has(s)).slice(0, 6);
          return out.products.length ? `Showing ${out.products.length}.` : "None of those came from search_products. Search first.";
        },
      }),
      betaZodTool({
        name: "draft_quote_request",
        description: "Draft a request for quote the visitor can send with one button: what they need, line by line, with quantities.",
        inputSchema: z.object({ lines: z.array(z.object({ description: z.string().describe("Brand, product and part number when known, or the need in plain words."), quantity: z.number().int().min(1).max(100000) })).min(1).max(30) }),
        run: async ({ lines }) => {
          out.quoteLines = lines.map((l) => ({ description: cleanCopy(l.description).slice(0, 300), quantity: l.quantity }));
          return "Drafted. The visitor sees a button to send it.";
        },
      }),
      betaZodTool({
        name: "offer_sales",
        description: "Offer to pass this conversation to our Sales team, who reply by email or phone.",
        inputSchema: z.object({ reason: z.string() }),
        run: async () => {
          out.handover = true;
          return "Offered. The visitor sees a form to leave their details.";
        },
      }),
    ];
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [...input.history.slice(-16).map((m) => ({ role: m.role, content: m.text })), { role: "user" as const, content: input.message.slice(0, 2000) }];
    try {
      const final = await this.client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 4000,
        max_iterations: 8,
        // If the model is busy, the API answers with the next model in its default chain.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: system(input.visitor, input.categories),
        tools,
        messages,
      });
      if (final.stop_reason === "refusal") return this.rules.reply(input);
      out.text = cleanCopy(
        final.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n\n"),
      );
      if (!out.text) out.text = out.products.length ? "Here is what I found." : "I couldn't find a match. Our Sales team can source it.";
      return out;
    } catch (e) {
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
        console.error("The assistant could not reach Claude; answering by rules instead:", e.message);
        return this.rules.reply(input);
      }
      throw e;
    }
  }
}

let engine: AssistantEngine | undefined;

/** Claude when ANTHROPIC_API_KEY is set, the rules otherwise. */
export function assistantEngine(): AssistantEngine {
  if (!engine) {
    const key = secret("ANTHROPIC_API_KEY");
    engine = key ? new ClaudeEngine(key) : new RulesEngine();
  }
  return engine;
}
