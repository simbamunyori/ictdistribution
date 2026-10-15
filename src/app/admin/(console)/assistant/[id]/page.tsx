import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { closeChatAction } from "@/app/admin/(console)/assistant-actions";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/card";
import { company, DEFAULT_TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/zoned";
import { chatMessages, chatQuoteLines } from "@/server/assistant/chats";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Assistant conversation" };

const STANDING = { retail: "individual prices", trade: "business prices", unverified: "individual prices, business not yet checked" } as Record<string, string>;

export default async function AssistantChatPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "handleAssistantChats")) redirect("/admin");
  const chat = await prisma.assistantChat.findUnique({ where: { id: (await params).id } });
  if (!chat) notFound();
  const [org, user, market] = await Promise.all([
    chat.organisationId ? prisma.organisation.findUnique({ where: { id: chat.organisationId }, select: { id: true, name: true } }) : null,
    chat.userId ? prisma.user.findUnique({ where: { id: chat.userId }, select: { name: true, email: true } }) : null,
    prisma.market.findUnique({ where: { code: chat.marketCode }, select: { name: true } }),
  ]);
  const when = (d: Date | string) => formatDateTime(new Date(d), company.staffLocale, DEFAULT_TIME_ZONE);
  const lines = chatQuoteLines(chat);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/assistant" className="text-link underline underline-offset-4">
          Assistant
        </Link>
      </p>
      <PageHeader title={chat.handoverName || user?.name || "Visitor"} lead={`${market?.name ?? chat.marketCode}, saw ${STANDING[chat.standing] ?? chat.standing}. Started ${when(chat.createdAt)}.`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-3 text-headline font-bold">Conversation</h2>
          <ol className="flex flex-col gap-3">
            {chatMessages(chat).map((m, i) => (
              <li key={i} className={cn("rounded-lg px-4 py-3 whitespace-pre-line", m.role === "user" ? "bg-surface" : "border border-line")}>
                <span className="block text-caption font-semibold text-ink-muted">
                  {m.role === "user" ? "Visitor" : "Assistant"}, {when(m.at)}
                </span>
                {m.text}
                {m.products?.length ? <span className="mt-1 block text-callout text-ink-muted">Showed: {m.products.join(", ")}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-2 text-headline font-bold">Who</h2>
            <dl className="flex flex-col gap-2 text-callout">
              {chat.handoverEmail ? (
                <div>
                  <dt className="font-semibold text-ink-muted">Reply to</dt>
                  <dd>
                    <a href={`mailto:${chat.handoverEmail}`} className="text-link underline underline-offset-4">
                      {chat.handoverEmail}
                    </a>
                    {chat.handoverPhone ? `, ${chat.handoverPhone}` : ""}
                  </dd>
                </div>
              ) : null}
              {user ? (
                <div>
                  <dt className="font-semibold text-ink-muted">Signed in as</dt>
                  <dd>
                    {user.name}, {user.email}
                  </dd>
                </div>
              ) : null}
              {org ? (
                <div>
                  <dt className="font-semibold text-ink-muted">Business</dt>
                  <dd>
                    <Link href={`/admin/customers/${org.id}`} className="text-link underline underline-offset-4">
                      {org.name}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {chat.handoverNote ? (
                <div>
                  <dt className="font-semibold text-ink-muted">Their note</dt>
                  <dd className="whitespace-pre-line">{chat.handoverNote}</dd>
                </div>
              ) : null}
            </dl>
            {chat.status === "CLOSED" ? (
              <p className="mt-4 text-callout">
                Closed by {chat.closedByLabel}
                {chat.closedAt ? `, ${when(chat.closedAt)}` : ""}.
              </p>
            ) : (
              <ActionForm action={closeChatAction} hidden={{ chatId: chat.id }} label="Mark dealt with" className="mt-4" />
            )}
          </Card>
          {lines.length ? (
            <Card>
              <h2 className="mb-2 text-headline font-bold">Quote request drafted</h2>
              <ul className="list-disc pl-5 text-callout">
                {lines.map((l, i) => (
                  <li key={i}>
                    {l.quantity} x {l.description}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
