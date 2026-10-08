import type { Metadata } from "next";
import { staffRemovePasskeyAction } from "@/app/admin/(console)/actions";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { stepUpFresh } from "@/server/auth/service";
import { prisma } from "@/server/db";
import { STAFF_ROLE_DESCRIPTION, STAFF_ROLE_LABEL } from "@/server/staff/access";

export const metadata: Metadata = { title: "Your account" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "never");

export default async function StaffAccount() {
  const session = await requireStaff();
  const [passkeys, microsoft] = await Promise.all([
    prisma.passkey.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "asc" } }),
    prisma.externalIdentity.findFirst({ where: { userId: session.userId, provider: "MICROSOFT" } }),
  ]);
  const fresh = stepUpFresh(session);
  return (
    <>
      <PageHeader title="Your account" lead={`${session.user.name}, ${session.user.email}`} />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <h2 className="text-headline font-bold">Role: {STAFF_ROLE_LABEL[session.user.staffRole]}</h2>
          <p className="mt-1 text-ink-muted">{STAFF_ROLE_DESCRIPTION[session.user.staffRole]} An Admin changes roles on the Staff page.</p>
        </Card>
        <Card>
          <h2 className="text-headline font-bold">Passkeys</h2>
          <p className="mt-1 text-callout text-ink-muted">You need one to sign in. Add a second on another device so losing one doesn&apos;t lock you out.</p>
          <ul className="mt-4 divide-y divide-line">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="block font-semibold text-ink">{p.name}</span>
                  <span className="text-caption text-ink-muted">
                    Added {day(p.createdAt)}, last used {day(p.lastUsedAt)}
                    {p.backedUp ? ", synced to your other devices" : ""}
                  </span>
                </span>
                {fresh && passkeys.length > 1 ? <ActionForm action={staffRemovePasskeyAction} hidden={{ passkeyId: p.id }} label="Remove" variant="destructive" confirm="Remove this passkey?" /> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 max-w-sm">
            {fresh ? (
              <PasskeyButton purpose="add" audience="STAFF" size="md">
                Add a passkey on this device
              </PasskeyButton>
            ) : (
              <a href={`/admin/confirm?next=${encodeURIComponent("/admin/account")}`} className={buttonClass("secondary")}>
                Confirm it&apos;s you to make changes
              </a>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="text-headline font-bold">Microsoft</h2>
          <p className="mt-1 text-callout text-ink-muted">
            {microsoft ? `Linked as ${microsoft.email}. You can start signing in with Microsoft, then use your passkey.` : "Not used yet. Signing in with your work Microsoft account links it, if it has the same email."}
          </p>
        </Card>
      </div>
    </>
  );
}
