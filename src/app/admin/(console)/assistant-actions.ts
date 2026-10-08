"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { closeChat, updateAssistantSettings } from "@/server/assistant/chats";
import { prisma } from "@/server/db";
import { staff } from "./staff-actor";

/** The site assistant, for staff: its settings and closing conversations passed to Sales. */

export async function updateAssistantSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { enabled: field(form, "enabled"), handoverEmail: field(form, "handoverEmail"), maxMessages: field(form, "maxMessages") };
  const result = await run(async () => {
    await updateAssistantSettings(prisma, actor, { enabled: values.enabled === "on", handoverEmail: values.handoverEmail, maxMessages: values.maxMessages }, ip);
    return "Saved.";
  }, values);
  revalidatePath("/admin/assistant");
  return result;
}

export async function closeChatAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "chatId");
  const result = await run(async () => {
    await closeChat(prisma, actor, id, ip);
    return "Closed.";
  });
  revalidatePath("/admin/assistant");
  revalidatePath(`/admin/assistant/${id}`);
  return result;
}
