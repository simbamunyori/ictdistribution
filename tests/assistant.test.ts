import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { askAssistant, chatByToken, chatMessages, chatQuoteLines, closeChat, handOver, updateAssistantSettings, type AskInput } from "../src/server/assistant/chats";
import { RulesEngine, type AssistantEngine, type EngineInput } from "../src/server/assistant/engine";
import { createCategory } from "../src/server/catalogue/categories";
import { createProduct } from "../src/server/catalogue/products";
import { findProducts } from "../src/server/catalogue/search";
import { setRate } from "../src/server/pricing/rates";
import { priceContext } from "../src/server/shop/prices";
import { createSupplier, saveOffer } from "../src/server/suppliers/suppliers";
import { db, hasDb, KEY, makeStaff } from "./helpers";

const tag = () => randomBytes(3).toString("hex").toLowerCase();

describe.skipIf(!hasDb)("search and the site assistant", () => {
  let admin: Awaited<ReturnType<typeof makeStaff>>;
  let word: string;
  let categorySlug: string;
  let notebook: { slug: string };
  let tradeOnly: { slug: string };

  const market = () => db.market.findUniqueOrThrow({ where: { code: "bw" } });
  const retail = async () => priceContext(db, await market(), "INDIVIDUAL", new Date());
  const settings = (over: Partial<{ enabled: boolean; handoverEmail: string; maxMessages: string }> = {}) => ({ enabled: true, handoverEmail: "", maxMessages: "30", ...over });

  async function ask(token: string | null, text: string, opts: { engine?: AssistantEngine; standing?: "retail" | "trade" | "unverified"; userId?: string | null } = {}) {
    const m = await market();
    const input: AskInput = { token, text, prices: await retail(), visitor: { standing: opts.standing ?? "retail", signedIn: Boolean(opts.userId), organisation: opts.standing && opts.standing !== "retail" ? "Kgale Data" : null, market: m.name, currency: m.currency, taxName: m.taxName, userId: opts.userId ?? null, organisationId: null, marketCode: m.code, locale: m.locale } };
    return askAssistant(db, opts.engine ?? new RulesEngine(), input);
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await makeStaff("ADMIN");
    await setRate(db, admin, "BWP", "13.65");
    await updateAssistantSettings(db, admin, settings());
    word = `zq${tag()}`;
    const category = await createCategory(db, admin, { name: `Portables ${word}`, description: "", parentId: null, sortOrder: 0, active: true, sourcingRule: null });
    categorySlug = category.slug;
    const supplier = await createSupplier(db, admin, { name: `Assist supplier ${tag()}`, kind: "LOCAL", country: "BW", currency: "BWP", email: "", whatsapp: "", phone: "", website: "", portalUrl: "", notes: "", leadTimeDays: "3", minOrder: "", landedCostPercent: "0", preferred: false, active: true });
    const make = async (name: string, cost: string, individuals: boolean) => {
      const mpn = `AS${tag().toUpperCase()}`;
      const p = await createProduct(db, admin, { name: `${name} ${word}`, brand: "Lenovo", mpn, categoryId: category.id, summary: `${name} for office work`, description: "", warrantyMonths: "12", warrantyTerms: "", sellToIndividuals: individuals, status: "ACTIVE", sourcingRule: null });
      await saveOffer(db, admin, { supplierId: supplier.id, productId: p.id, cost, supplierSku: "", leadTimeDays: "", moq: "", stock: "", active: true });
      return p;
    };
    notebook = await make("Notebook Pro 14", "5000.00", true);
    await make("Notebook Max 16", "20000.00", true);
    tradeOnly = await make("Docking station", "900.00", false);
  });

  it("finds products by other words for the same thing, by most of the words and by spelling", async () => {
    const prices = await retail();
    const byOther = await findProducts(db, { query: `laptop ${word}` }, prices);
    expect(byOther.kind).toBe("all");
    expect(byOther.items.map((p) => p.slug)).toContain(notebook.slug);
    const most = await findProducts(db, { query: `notebook ${word} purple-unicorn` }, prices);
    expect(most.kind).toBe("most");
    const close = await findProducts(db, { query: `notebok pro ${word.slice(0, -1)}` }, prices);
    expect(["all", "most", "close"]).toContain(close.kind);
    expect(close.items.length).toBeGreaterThan(0);
    // A budget leaves out what costs more, in the visitor's currency.
    const cheap = await findProducts(db, { query: `notebook ${word}`, maxPriceMinor: 10_000_00n }, prices);
    expect(cheap.items.map((p) => p.slug)).toEqual([notebook.slug]);
    expect((await findProducts(db, { query: word, category: categorySlug }, prices)).items).toHaveLength(3);
  });

  it("answers by rules, keeps the conversation and drafts a quote for a business", async () => {
    const first = await ask(null, `laptop ${word}`);
    expect(first.engine).toBe("rules");
    expect(first.token).toBeTruthy();
    const msgs = chatMessages(first.chat);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].products).toContain(notebook.slug);
    expect(chatQuoteLines(first.chat)).toEqual([]);
    const again = await ask(first.token, `docking ${word}`);
    expect(again.chat.id).toBe(first.chat.id);
    expect(chatMessages(again.chat)).toHaveLength(4);

    const biz = await ask(null, `5 notebooks ${word}`, { standing: "trade" });
    expect(chatQuoteLines(biz.chat)[0]).toMatchObject({ quantity: 5 });
    // Someone else holding the cookie of a signed-in person's conversation gets a new one.
    const mine = await ask(null, `notebook ${word}`, { userId: admin.userId });
    expect((await ask(mine.token, `notebook ${word}`, { userId: null })).chat.id).not.toBe(mine.chat.id);
  });

  it("gives the engine only what the shop shows the visitor", async () => {
    let seen: Awaited<ReturnType<EngineInput["search"]>> = [];
    const spy: AssistantEngine = {
      name: "spy",
      async reply(input) {
        seen = await input.search({ query: word });
        return { text: "Here you are\u0021 The best one \u2014 truly.", products: seen.map((p) => p.slug), quoteLines: null, handover: true };
      },
    };
    const out = await ask(null, "anything", { engine: spy });
    expect(chatMessages(out.chat)[1]).toMatchObject({ text: "Here you are. The best one, truly.", offerSales: true });
    const json = JSON.stringify(seen, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).not.toMatch(/supplier|landed|cost/i);
    const trade = seen.find((p) => p.slug === tradeOnly.slug)!;
    expect(trade.canBuy).toBe(false);
    expect(seen.find((p) => p.slug === notebook.slug)).toMatchObject({ canBuy: true, price: expect.stringMatching(/P/) });
  });

  it("passes a conversation to Sales, who can close it", async () => {
    const { token, chat } = await ask(null, `notebook ${word}`);
    await expect(handOver(db, { key: KEY }, token, { name: "", email: "nope", phone: "", note: "" })).rejects.toMatchObject({ fieldErrors: { name: expect.any(String), email: expect.any(String) } });
    await expect(handOver(db, { key: KEY }, "not-a-token", { name: "Neo", email: "neo@example.co.bw", phone: "", note: "" })).rejects.toThrow(/Start by/);
    const sales = await makeStaff("SALES");
    await handOver(db, { key: KEY }, token, { name: "Neo Kgosi", email: "Neo@Example.co.bw", phone: "+267 71 000 000", note: "Need 20 by month end." });
    const after = await chatByToken(db, token);
    expect(after).toMatchObject({ status: "HANDED_OVER", handoverEmail: "neo@example.co.bw" });
    expect(await db.outboundEmail.count({ where: { kind: "assistant.handover", toAddress: sales.email } })).toBe(1);
    // A conversation passed on takes no more questions.
    expect((await ask(token, "and a mouse")).chat.id).not.toBe(chat.id);
    await expect(closeChat(db, await makeStaff("FINANCE"), chat.id)).rejects.toThrow(/role/);
    await closeChat(db, sales, chat.id);
    expect(await db.assistantChat.findUniqueOrThrow({ where: { id: chat.id } })).toMatchObject({ status: "CLOSED", closedByLabel: sales.name });
  });

  it("follows the settings: off, a message limit and who may change them", async () => {
    await expect(updateAssistantSettings(db, await makeStaff("FINANCE"), settings())).rejects.toThrow(/role/);
    await expect(updateAssistantSettings(db, admin, settings({ maxMessages: "2", handoverEmail: "x" }))).rejects.toMatchObject({ fieldErrors: { maxMessages: expect.any(String), handoverEmail: expect.any(String) } });
    try {
      await updateAssistantSettings(db, admin, settings({ maxMessages: "5" }));
      let token: string | null = null;
      for (let i = 0; i < 5; i++) token = (await ask(token, `notebook ${word}`)).token;
      await expect(ask(token, "one more")).rejects.toThrow(/long enough/);
      await updateAssistantSettings(db, admin, settings({ enabled: false }));
      await expect(ask(null, "hello")).rejects.toThrow(/off/);
      await expect(ask(null, "   ")).rejects.toMatchObject({ field: "text" });
    } finally {
      await updateAssistantSettings(db, admin, settings());
    }
  });
});
