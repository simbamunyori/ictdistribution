import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { secret } from "@/server/secrets";

/**
 * The WhatsApp Business Cloud API (Meta's Graph API): sending a template
 * message, fetching a file a supplier sent, and checking and reading the
 * webhook calls Meta makes when a message arrives or changes status.
 * Settings are in .env (docs/quotes.md, "WhatsApp"); while they are
 * unset, WhatsApp requests are sent by hand from the admin area.
 */

export const GRAPH_URL = "https://graph.facebook.com/v23.0";
/** The largest file we fetch from a supplier: their quote as a PDF or a photo. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  template: string;
  language: string;
}

/** What sending needs: the token, the business number's id and the approved template. Null while any is missing. */
export function whatsappConfig(): WhatsAppConfig | null {
  const e = env();
  const token = secret("WHATSAPP_TOKEN");
  if (!token || !e.WHATSAPP_PHONE_NUMBER_ID || !e.WHATSAPP_TEMPLATE) return null;
  return { token, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID, template: e.WHATSAPP_TEMPLATE, language: e.WHATSAPP_TEMPLATE_LANGUAGE };
}

/** For the admin area: whether requests go out and replies come in, and which settings are missing. */
export function whatsappStatus() {
  const e = env();
  const has = { WHATSAPP_TOKEN: Boolean(secret("WHATSAPP_TOKEN")), WHATSAPP_PHONE_NUMBER_ID: Boolean(e.WHATSAPP_PHONE_NUMBER_ID), WHATSAPP_TEMPLATE: Boolean(e.WHATSAPP_TEMPLATE), WHATSAPP_APP_SECRET: Boolean(secret("WHATSAPP_APP_SECRET")), WHATSAPP_VERIFY_TOKEN: Boolean(secret("WHATSAPP_VERIFY_TOKEN")) };
  const sending = has.WHATSAPP_TOKEN && has.WHATSAPP_PHONE_NUMBER_ID && has.WHATSAPP_TEMPLATE;
  const receiving = has.WHATSAPP_TOKEN && has.WHATSAPP_APP_SECRET && has.WHATSAPP_VERIFY_TOKEN;
  return { sending, receiving, missing: Object.entries(has).flatMap(([k, v]) => (v ? [] : [k])) };
}

/** A number as WhatsApp writes it: digits only, with the country code. */
export const digits = (number: string) => number.replace(/\D/g, "");

/** Meta signs each webhook call with the app secret: X-Hub-Signature-256 is sha256= and the HMAC of the raw body. */
export function verifySignature(rawBody: string | Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody))
    .digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Setting up the webhook: Meta asks with our verify token and expects its challenge back. Null refuses. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  const given = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") !== "subscribe" || given.length !== verifyToken.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(verifyToken))) return null;
  return params.get("hub.challenge");
}

export interface InboundMessage {
  /** WhatsApp's id for it (wamid). */
  id: string;
  /** Their number, digits only. */
  from: string;
  /** Their WhatsApp profile name, when given. */
  name: string;
  at: Date;
  type: string;
  /** The text, or a file's caption. */
  text: string;
  /** Our message they replied to, when they used reply. */
  contextId: string | null;
  media: { id: string; mimeType: string; filename: string } | null;
}

export interface StatusUpdate {
  /** Our message's wamid. */
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: Date;
  error: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const when = (v: unknown) => {
  const n = Number(str(v));
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

/** The messages and status changes in one webhook call. Anything else in it (reactions, system messages) is left out. */
export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  if (obj(body).object !== "whatsapp_business_account") return { messages, statuses };
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      if (obj(change).field !== "messages") continue;
      const value = obj(obj(change).value);
      const names = new Map(arr(value.contacts).map((c) => [digits(str(obj(c).wa_id)), str(obj(obj(c).profile).name)]));
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const id = str(m.id);
        const from = digits(str(m.from));
        const type = str(m.type);
        if (!id || !from) continue;
        const file = type === "document" || type === "image" ? obj(m[type]) : null;
        messages.push({
          id,
          from,
          name: names.get(from) ?? "",
          at: when(m.timestamp),
          type,
          text: type === "text" ? str(obj(m.text).body) : file ? str(file.caption) : "",
          contextId: str(obj(m.context).id) || null,
          media: file && str(file.id) ? { id: str(file.id), mimeType: str(file.mime_type), filename: str(file.filename) || (type === "image" ? "photo" : "document") } : null,
        });
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const status = str(s.status);
        if (!str(s.id) || !["sent", "delivered", "read", "failed"].includes(status)) continue;
        const e = obj(arr(s.errors)[0]);
        const error = status === "failed" ? [str(e.title) || str(e.message) || "Failed", str(obj(e.error_data).details)].filter(Boolean).join(": ") || "Failed" : null;
        statuses.push({ id: str(s.id), status: status as StatusUpdate["status"], at: when(s.timestamp), error });
      }
    }
  }
  return { messages, statuses };
}

/** A failed call. `retry` is false when trying again won't help, such as a number not on WhatsApp or a template not approved. */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<WhatsAppError> {
  const body = obj(await res.json().catch(() => ({})));
  const e = obj(body.error);
  const details = str(obj(e.error_data).details);
  const message = [str(e.message) || `WhatsApp answered ${res.status}`, details].filter(Boolean).join(": ").slice(0, 500);
  // Too many calls, or trouble on their side: try again later. Anything else is about the message itself.
  return new WhatsAppError(message, res.status === 429 || res.status >= 500);
}

/** Calls to the Graph API. `fetch` is looked up on each call, so tests can stub it. */
export class CloudApi {
  constructor(private cfg: Pick<WhatsAppConfig, "token" | "phoneNumberId">) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.cfg.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new WhatsAppError(`WhatsApp couldn't be reached: ${e instanceof Error ? e.message : "unknown error"}`, true);
    }
  }

  /** Sends an approved template with its body values in order. Returns the message's wamid. */
  async sendTemplate(to: string, template: string, language: string, values: string[]): Promise<string> {
    const res = await this.call(`${GRAPH_URL}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "template", template: { name: template, language: { code: language }, components: [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }] } }),
    });
    if (!res.ok) throw await failure(res);
    const id = str(obj(arr(obj(await res.json()).messages)[0]).id);
    if (!id) throw new WhatsAppError("WhatsApp didn't say the message was accepted.", true);
    return id;
  }

  /** A file a supplier sent: its address first, then the file itself, both with our token. Refuses anything over the cap. */
  async downloadMedia(mediaId: string, maxBytes = MAX_MEDIA_BYTES): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const meta = await this.call(`${GRAPH_URL}/${encodeURIComponent(mediaId)}`);
    if (!meta.ok) throw await failure(meta);
    const info = obj(await meta.json());
    const url = str(info.url);
    if (!url.startsWith("https://")) throw new WhatsAppError("WhatsApp gave no address for the file.", false);
    if (Number(info.file_size) > maxBytes) throw new WhatsAppError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, false);
    const res = await this.call(url);
    if (!res.ok) throw await failure(res);
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new WhatsAppError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, false);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new WhatsAppError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, false);
    return { bytes, mimeType: str(info.mime_type) || res.headers.get("content-type") || "application/octet-stream" };
  }
}
