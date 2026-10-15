"use server";

import { run, type ActionState } from "@/server/action-state";
import { requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { answerFromForm, answerRequest } from "@/server/quotes/suppliers";
import { redis } from "@/server/redis";
import { appKey } from "@/server/secrets";
import { enforce, LIMITS } from "@/server/security/rate-limit";

/** A supplier answers our request for price from the link in our email or WhatsApp message. */
export async function answerRfqAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ip = (await requestContext()).ipAddress ?? "unknown";
  const values = Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$") && k !== "token").map(([k, v]) => [k, String(v)]));
  const result = await run(async () => {
    await enforce(redis(), `rfq-answer:${ip}`, LIMITS.quoteAnswersPerIp);
    await answerRequest(prisma, { key: appKey(), replyTo: env().QUOTES_EMAIL }, String(form.get("token") ?? ""), answerFromForm(form));
    return "Thank you. We have your prices. You can change them on this page until the deadline.";
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  return result;
}
