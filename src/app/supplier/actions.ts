"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionState } from "@/server/action-state";
import { requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { addPoDocument, confirmFromForm, confirmPurchaseOrder, shipFromForm, shipPurchaseOrder } from "@/server/procurement/supplier";
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

const poValues = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$") && k !== "token" && k !== "line").map(([k, v]) => [k, String(v)]));

/** A supplier's change to a purchase order from its link: one limit per address for all of them. */
async function poChange(form: FormData, work: (token: string) => Promise<string>, values: Record<string, string>) {
  const ip = (await requestContext()).ipAddress ?? "unknown";
  const token = String(form.get("token") ?? "");
  const result = await run(async () => {
    await enforce(redis(), `po-answer:${ip}`, LIMITS.poAnswersPerIp);
    return work(token);
  }, values);
  if (result.ok) {
    revalidatePath(`/supplier/po/${token}`);
    await runSoon("email-deliver").catch(() => undefined);
  }
  return result;
}

const poDeps = () => ({ key: appKey(), replyTo: env().QUOTES_EMAIL });

export async function confirmPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  return poChange(
    form,
    async (token) => {
      await confirmPurchaseOrder(prisma, poDeps(), { token }, confirmFromForm(form));
      return "Thank you. We have your confirmation. You can change it here until it ships.";
    },
    poValues(form),
  );
}

export async function shipPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  return poChange(
    form,
    async (token) => {
      await shipPurchaseOrder(prisma, poDeps(), { token }, shipFromForm(form));
      return "Thank you. We have it as shipped.";
    },
    poValues(form),
  );
}

export async function poDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return poChange(
    form,
    async (token) => {
      const f = form.get("file");
      const file = f instanceof File && f.size ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
      await addPoDocument(prisma, poDeps(), { token }, String(form.get("kind") ?? ""), file);
      return "Thank you. We have the file.";
    },
    { kind: String(form.get("kind") ?? "") },
  );
}
