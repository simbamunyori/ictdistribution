import { prisma } from "@/server/db";
import { runSoon } from "@/server/jobs/boss";
import { secret } from "@/server/secrets";
import { parseWebhook, verifyHandshake, verifySignature } from "@/server/whatsapp/cloud";
import { recordWebhook } from "@/server/whatsapp/inbound";

/**
 * Meta's webhook for the WhatsApp Business number (docs/quotes.md,
 * "WhatsApp"). GET is the one-off handshake when the webhook is set up.
 * POST carries suppliers' messages and our messages' delivery status,
 * signed with the app secret. Messages are stored and read by the
 * whatsapp job, so Meta gets its answer at once.
 */

export const dynamic = "force-dynamic";

/** The largest call we accept. Files arrive as ids, so real calls are small. */
const MAX_BODY = 1024 * 1024;

export async function GET(req: Request) {
  const challenge = verifyHandshake(new URL(req.url).searchParams, secret("WHATSAPP_VERIFY_TOKEN"));
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  const appSecret = secret("WHATSAPP_APP_SECRET");
  if (!appSecret) return new Response("Not found", { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("Too large", { status: 413 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BODY) return new Response("Too large", { status: 413 });
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const stored = await recordWebhook(prisma, parseWebhook(body));
  if (stored) await runSoon("whatsapp").catch((e) => console.error("Starting the whatsapp job failed; its schedule will pick the message up:", e));
  return new Response("OK");
}
