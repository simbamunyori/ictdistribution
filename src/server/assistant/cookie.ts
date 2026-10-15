import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { shopper } from "@/server/shop/viewer";
import { chatByToken } from "./chats";

export const ASSISTANT_COOKIE = "assistant";

export async function assistantToken(): Promise<string | null> {
  return (await cookies()).get(ASSISTANT_COOKIE)?.value ?? null;
}

export async function setAssistantToken(token: string | null) {
  const jar = await cookies();
  if (token) jar.set(ASSISTANT_COOKIE, token, { path: "/", maxAge: 30 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true });
  else jar.delete(ASSISTANT_COOKIE);
}

/** This visitor's conversation, if they have one. One started before signing in carries on after; one by someone signed in is theirs alone. */
export async function currentChat() {
  const [chat, s] = await Promise.all([assistantToken().then((t) => chatByToken(prisma, t)), shopper()]);
  return chat && (chat.userId === null || chat.userId === (s.user?.id ?? null)) ? chat : null;
}
