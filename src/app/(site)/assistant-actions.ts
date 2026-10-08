"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { askAssistant, handOver } from "@/server/assistant/chats";
import { assistantToken, setAssistantToken } from "@/server/assistant/cookie";
import { assistantEngine } from "@/server/assistant/engine";
import { requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { appKey } from "@/server/secrets";
import { enforce, LIMITS } from "@/server/security/rate-limit";
import { shopPrices, shopper } from "@/server/shop/viewer";

/** The site assistant: asking, starting again and passing to Sales. */

export async function askAssistantAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { text: field(form, "text") };
  const ip = (await requestContext()).ipAddress ?? "unknown";
  const result = await run(async () => {
    await enforce(redis(), `assistant:${ip}`, LIMITS.assistantPerIp);
    const [s, prices, token] = await Promise.all([shopper(), shopPrices(), assistantToken()]);
    const out = await askAssistant(prisma, assistantEngine(), {
      token,
      text: values.text,
      prices,
      visitor: { standing: s.standing, signedIn: Boolean(s.user), organisation: s.organisation?.name ?? null, market: s.market.name, currency: s.market.currency, taxName: s.market.taxName, userId: s.user?.id ?? null, organisationId: s.organisation?.id ?? null, marketCode: s.market.code, locale: s.market.locale },
    });
    if (out.token !== token) await setAssistantToken(out.token);
  }, values);
  revalidatePath("/assistant");
  return result;
}

export async function startAgainAction() {
  await setAssistantToken(null);
  revalidatePath("/assistant");
}

export async function handOverAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name"), email: field(form, "email"), phone: field(form, "phone"), note: field(form, "note") };
  const ip = (await requestContext()).ipAddress ?? "unknown";
  const result = await run(async () => {
    await enforce(redis(), `assistant-handover:${ip}`, LIMITS.assistantHandoversPerIp);
    await handOver(prisma, { key: appKey() }, await assistantToken(), values);
    return "Sent. Our Sales team will reply by email, usually within a working day.";
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath("/assistant");
  return result;
}
