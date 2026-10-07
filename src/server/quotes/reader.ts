import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Table } from "@/lib/price-list";
import { guessCategory, readTable, readText, type ReadLine } from "@/lib/quote-reading";
import { secret } from "@/server/secrets";

/**
 * Reading requests for quote and supplier replies. With ANTHROPIC_API_KEY
 * set, Claude reads them: typed lists, spreadsheets, tender PDFs and
 * plain email replies. Without it, or when Claude can't be reached, the
 * rules in src/lib/quote-reading.ts read what they can and flag the rest
 * for a person. Either way the result is the same shape, so nothing
 * downstream knows which read it.
 */

export interface RequestInput {
  text: string;
  /** A spreadsheet already read into cells. */
  table?: Table | null;
  /** A PDF, such as a tender document. */
  pdf?: { name: string; bytes: Uint8Array } | null;
  categories: { slug: string; name: string }[];
}

export interface ReplyLineInput {
  /** L1, L2 and so on, as numbered in our request. */
  ref: string;
  description: string;
  quantity: number;
}

export interface ReplyLine {
  ref: string;
  noOffer: boolean;
  /** Per unit, as decimal text in the reply's currency. */
  unitPrice: string | null;
  currency: string | null;
  available: number | null;
  leadTimeDays: number | null;
  /** yyyy-mm-dd */
  validUntil: string | null;
  notes: string;
}

export interface QuoteReader {
  /** "claude" or "rules", shown to staff with what it read. */
  readonly name: string;
  readRequest(input: RequestInput): Promise<ReadLine[]>;
  /** Null when it can't read prices from the reply: a person enters them. */
  readSupplierReply(input: { text: string; lines: ReplyLineInput[]; currency: string }): Promise<ReplyLine[] | null>;
}

/** The rules alone: no AI. A PDF becomes one flagged line for a person to read. */
export class RulesReader implements QuoteReader {
  readonly name = "rules";
  async readRequest(input: RequestInput): Promise<ReadLine[]> {
    const lines = [...(input.table ? readTable(input.table) : []), ...readText(input.text)];
    if (input.pdf) lines.push({ original: input.pdf.name, description: `Read ${input.pdf.name} and enter its lines`, quantity: null, unclear: "A document to read: enter its lines by hand." });
    return lines.map((l) => ({ ...l, category: l.category ?? guessCategory(l.description, input.categories) }));
  }
  async readSupplierReply(): Promise<ReplyLine[] | null> {
    return null;
  }
}

export const MODEL = "claude-opus-5-5";

const RequestLines = z.object({
  lines: z.array(
    z.object({
      original: z.string().describe("The item as the customer wrote it, word for word."),
      description: z.string().describe("A clean description: brand, product and the specification that matters."),
      brand: z.string().nullable(),
      mpn: z.string().nullable().describe("The manufacturer part number, only if the request gives one."),
      quantity: z.number().int().nullable().describe("Units wanted. Null if the request doesn't say."),
      category: z.string().nullable().describe("The slug of the best matching category from the list, or null."),
      unclear: z.string().nullable().describe("If a person must check this line, why, in one plain sentence. Otherwise null."),
    }),
  ),
});

const ReplyLines = z.object({
  readable: z.boolean().describe("False if the reply gives no prices we can use."),
  lines: z.array(
    z.object({
      ref: z.string(),
      noOffer: z.boolean().describe("True if they say they can't supply it."),
      unitPrice: z.string().nullable().describe("Price per unit as plain decimal text, such as 1234.50. No currency sign or thousands separators."),
      currency: z.string().nullable().describe("ISO 4217 code if the reply names one."),
      available: z.number().int().nullable(),
      leadTimeDays: z.number().int().nullable().describe("Days to deliver to us. Convert weeks to days."),
      validUntil: z.string().nullable().describe("yyyy-mm-dd, if they say how long the price holds."),
      notes: z.string(),
    }),
  ),
});

const REQUEST_PROMPT = `You read requests for quote sent to an ICT distributor: typed lists, pasted emails, spreadsheets and tender documents.

Return every product or service line the customer wants priced. For each line give the original text, a clean description, the brand and manufacturer part number only when given, the quantity, and the category slug from the list below that fits best.

Rules:
- Never invent a part number, brand or quantity. Use null when the request doesn't say.
- Leave out greetings, signatures, delivery instructions and terms. Put tender conditions only in "unclear" of the line they affect.
- Set "unclear" when a person must check a line: no quantity, two possible products, a specification that conflicts, or something we would need to ask the customer.
- Keep the customer's order.

Categories (slug: name):
`;

const REPLY_PROMPT = `You read a supplier's email reply to our request for price. Our request numbered each line L1, L2 and so on.

For each line they answer, give the price per unit, currency, quantity available, lead time in days, how long the price holds, and any note. If they can't supply a line, set noOffer. If they give a total for a line instead of a unit price, divide by the quantity. Never guess a price. Set readable to false if the reply has no usable prices.`;

/** Claude, with the rules as a fallback when the call fails. */
export class ClaudeReader implements QuoteReader {
  readonly name = "claude";
  private client: Anthropic;
  private rules = new RulesReader();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  private async parse<T extends z.ZodType>(schema: T, content: Anthropic.Beta.Messages.BetaContentBlockParam[]): Promise<z.infer<T> | null> {
    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If the model is busy, the API answers with the next model in its default chain.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(schema), effort: "medium" },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    return (response.parsed_output as z.infer<T> | null) ?? null;
  }

  async readRequest(input: RequestInput): Promise<ReadLine[]> {
    const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
    if (input.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(input.pdf.bytes).toString("base64") }, title: input.pdf.name });
    const table = input.table ? `\n\nSpreadsheet, one row per line, cells separated by |:\n${input.table.slice(0, 600).map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))).join(" | ")).join("\n")}` : "";
    const categories = input.categories.map((c) => `${c.slug}: ${c.name}`).join("\n");
    content.push({ type: "text", text: `${REQUEST_PROMPT}${categories}\n\nThe request:\n${input.text.slice(0, 50_000) || "(no text)"}${table}` });
    try {
      const out = await this.parse(RequestLines, content);
      if (!out) return this.rules.readRequest(input);
      const slugs = new Set(input.categories.map((c) => c.slug));
      return out.lines.map((l) => ({
        ...l,
        quantity: l.quantity !== null && l.quantity > 0 ? l.quantity : null,
        category: l.category && slugs.has(l.category) ? l.category : guessCategory(l.description, input.categories),
        unclear: l.unclear ?? (l.quantity !== null && l.quantity > 0 ? null : "No quantity given."),
      }));
    } catch (e) {
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
        console.error("Quote reading with Claude failed; reading by rules instead:", e.message);
        return this.rules.readRequest(input);
      }
      throw e;
    }
  }

  async readSupplierReply(input: { text: string; lines: ReplyLineInput[]; currency: string }): Promise<ReplyLine[] | null> {
    const asked = input.lines.map((l) => `${l.ref}: ${l.quantity} x ${l.description}`).join("\n");
    const text = `${REPLY_PROMPT}\n\nWe asked for prices in ${input.currency}:\n${asked}\n\nTheir reply:\n${input.text.slice(0, 30_000)}`;
    try {
      const out = await this.parse(ReplyLines, [{ type: "text", text }]);
      if (!out?.readable) return null;
      const refs = new Set(input.lines.map((l) => l.ref));
      return out.lines.filter((l) => refs.has(l.ref));
    } catch (e) {
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
        console.error("Reading a supplier reply with Claude failed; leaving it for a person:", e.message);
        return null;
      }
      throw e;
    }
  }
}

let reader: QuoteReader | undefined;

/** Claude when ANTHROPIC_API_KEY is set, the rules otherwise. */
export function quoteReader(): QuoteReader {
  if (!reader) {
    const key = secret("ANTHROPIC_API_KEY");
    reader = key ? new ClaudeReader(key) : new RulesReader();
  }
  return reader;
}
