"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { actorFor } from "@/server/accounts/organisations";
import { currentSession, requestContext, requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { acceptQuote, declineQuote, type Answerer } from "@/server/quotes/customer";
import { requestQuote } from "@/server/quotes/intake";
import { redis } from "@/server/redis";
import { appKey } from "@/server/secrets";
import { enforce, LIMITS } from "@/server/security/rate-limit";

/** Customers asking for quotes and answering them. */

const deps = () => ({ key: appKey(), replyTo: env().QUOTES_EMAIL });
const REQUEST_FIELDS = ["type", "text", "customerReference", "tenderReference", "tenderDeadline", "requiredDocuments", "phone"] as const;

export async function requestQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account/quotes/new");
  const actor = await actorFor(prisma, session);
  const values = { ...(Object.fromEntries(REQUEST_FIELDS.map((k) => [k, field(form, k)])) as Record<(typeof REQUEST_FIELDS)[number], string>), urgent: form.get("urgent") === "on" ? "on" : "" };
  let number = "";
  const result = await run(async () => {
    await enforce(redis(), `quotes:${session.userId}`, LIMITS.quotesPerUser);
    const f = form.get("file");
    const file = f instanceof File && f.size ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    const q = await requestQuote(prisma, deps(), { userId: session.userId, organisationId: actor?.organisationId ?? null, role: actor?.role ?? null }, { ...values, urgent: values.urgent === "on" }, file);
    number = q.number;
  }, values);
  if (!result.ok) return result;
  // Reading and pricing start now; with background jobs off (a test server) they run here.
  await runSoon("quotes").catch((e) => console.error("Starting the quotes job failed; its schedule will pick the request up:", e));
  await runSoon("email-deliver").catch(() => undefined);
  revalidatePath("/account/quotes");
  redirect(`/quotes/${encodeURIComponent(number)}?requested=1`);
}

/** The link's token from the page, or the signed-in customer. */
async function answerer(form: FormData): Promise<Answerer> {
  const token = field(form, "t");
  if (token) return { token };
  const session = await currentSession("CUSTOMER");
  if (session?.stage !== "ACTIVE") return {};
  const actor = await actorFor(prisma, session);
  return { viewer: { userId: session.userId, organisationId: actor?.organisationId ?? null, role: actor?.role ?? null, name: session.user.name } };
}

export async function acceptQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const number = field(form, "number");
  const ip = (await requestContext()).ipAddress ?? null;
  const result = await run(async () => {
    await enforce(redis(), `quote-answer:${ip ?? "unknown"}`, LIMITS.quoteAnswersPerIp);
    await acceptQuote(prisma, deps(), number, await answerer(form), ip);
    return "Accepted. Thank you: we will send your pro forma invoice and confirm delivery.";
  });
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath(`/quotes/${number}`);
  return result;
}

export async function declineQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const number = field(form, "number");
  const ip = (await requestContext()).ipAddress ?? null;
  const values = { reason: field(form, "reason") };
  const result = await run(async () => {
    await enforce(redis(), `quote-answer:${ip ?? "unknown"}`, LIMITS.quoteAnswersPerIp);
    await declineQuote(prisma, deps(), number, await answerer(form), values.reason, ip);
    return "Thank you for letting us know.";
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath(`/quotes/${number}`);
  return result;
}
