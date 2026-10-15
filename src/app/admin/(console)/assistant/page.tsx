import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { updateAssistantSettingsAction } from "@/app/admin/(console)/assistant-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { company, DEFAULT_TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/zoned";
import { assistantSettings, chatMessages, staffChats } from "@/server/assistant/chats";
import { assistantEngine } from "@/server/assistant/engine";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Assistant" };

const VIEWS = { HANDED_OVER: "Passed to Sales", OPEN: "Recent conversations", CLOSED: "Closed" } as const;

/** Conversations from the site assistant, newest handovers first, and its settings. */
export default async function AssistantAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "handleAssistantChats")) redirect("/admin");
  const sp = await searchParams;
  const view = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).find((k) => k === sp.show) ?? "HANDED_OVER";
  const [chats, settings] = await Promise.all([staffChats(prisma, view), assistantSettings(prisma)]);
  const when = (d: Date) => formatDateTime(d, company.staffLocale, DEFAULT_TIME_ZONE);
  return (
    <>
      <PageHeader title="Assistant" lead={`The assistant on the site finds products by need, shows each visitor the prices the shop shows them and drafts quote requests. It ${assistantEngine().name === "claude" ? "uses Claude" : "searches by rules, as ANTHROPIC_API_KEY is not set"}. Never shown to visitors: suppliers, costs and margins.`} />
      <div className="flex flex-col gap-6">
        <Card>
          <nav aria-label="Which conversations" className="mb-4 flex flex-wrap gap-2 text-callout">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => (
              <Link key={k} href={k === "HANDED_OVER" ? "/admin/assistant" : `/admin/assistant?show=${k}`} aria-current={k === view ? "page" : undefined} className={cn("rounded-md border border-line px-3 py-2 font-semibold hover:bg-surface", k === view && "border-brand bg-surface")}>
                {VIEWS[k]}
              </Link>
            ))}
          </nav>
          {chats.length ? (
            <TableWrap label={VIEWS[view]}>
              <table className="w-full min-w-[40rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Visitor</th>
                    <th className={th}>Asked first</th>
                    <th className={th}>{view === "HANDED_OVER" ? "Passed on" : "Last message"}</th>
                  </tr>
                </thead>
                <tbody>
                  {chats.map((c) => (
                    <tr key={c.id}>
                      <td className={td}>
                        <Link href={`/admin/assistant/${c.id}`} className="font-semibold text-link underline underline-offset-4">
                          {c.handoverName || (c.userId ? "Signed-in customer" : "Visitor")}
                        </Link>
                        <span className="block text-ink-muted">{c.handoverEmail || `${c.userMessages} ${c.userMessages === 1 ? "message" : "messages"}`}</span>
                      </td>
                      <td className={td}>{(chatMessages(c).find((m) => m.role === "user")?.text ?? "").slice(0, 140)}</td>
                      <td className={td}>{when(view === "HANDED_OVER" && c.handedOverAt ? c.handedOverAt : c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">{view === "HANDED_OVER" ? "Nobody is waiting for Sales." : "None yet."}</p>
          )}
        </Card>
        <Card className="max-w-3xl">
          <h2 className="mb-4 text-headline font-bold">Settings</h2>
          <SpecForm
            action={updateAssistantSettingsAction}
            disabled={!staffCan(role, "manageAssistant")}
            fields={[
              { kind: "checkbox", id: "enabled", label: "Show the assistant on the site", defaultChecked: settings.enabled },
              { kind: "text", id: "handoverEmail", label: "Email handovers to (optional)", type: "email", defaultValue: settings.handoverEmail, hint: "Empty: every Sales staff member, or Admins when there are none." },
              { kind: "text", id: "maxMessages", label: "Most messages in one conversation", inputMode: "numeric", defaultValue: String(settings.maxMessages) },
            ]}
            submitLabel="Save settings"
            pendingLabel="Saving"
          />
        </Card>
      </div>
    </>
  );
}
