import type { Metadata } from "next";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { requireCustomer } from "@/server/auth/next";
import { stepUpFresh } from "@/server/auth/service";
import { enabledProviders } from "@/server/auth/sign-in-options";
import { prisma } from "@/server/db";
import { removePasskeyAction, unlinkAction } from "../actions";

export const metadata: Metadata = { title: "How you sign in" };

const LINK_ERRORS: Record<string, string> = {
  email: "That account is for a different email address. Use one with the same email as this account.",
  taken: "That account is already linked to someone else.",
  failed: "Linking didn't work. Try again.",
  cancelled: "Linking was cancelled.",
  busy: "Too many tries. Wait a few minutes and try again.",
};

export default async function SignInMethods({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireCustomer("/account/sign-in-methods");
  const [passkeys, identities] = await Promise.all([
    prisma.passkey.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "asc" } }),
    prisma.externalIdentity.findMany({ where: { userId: session.userId } }),
  ]);
  const providers = enabledProviders("CUSTOMER");
  const fresh = stepUpFresh(session);
  const confirm = `/account/confirm?next=${encodeURIComponent("/account/sign-in-methods")}`;

  return (
    <>
      <PageHeader title="How you sign in" lead={`A code sent to ${session.user.email} always works. Add a passkey or link an account to sign in faster.`} />
      {q.linked ? <Alert tone="positive" className="mb-6">Linked. You can now sign in with it.</Alert> : null}
      {q["link-error"] && LINK_ERRORS[q["link-error"]] ? <Alert className="mb-6">{LINK_ERRORS[q["link-error"]]}</Alert> : null}

      <div className="grid gap-6">
        <Card>
          <h2 className="text-headline font-bold">Passkeys</h2>
          <p className="mt-1 text-callout text-ink-muted">Your fingerprint, face or device PIN. Nothing to type, and nothing anyone can steal from us.</p>
          {passkeys.length ? (
            <ul className="mt-4 divide-y divide-line">
              {passkeys.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-semibold text-ink">{p.name}</span>
                    <span className="text-caption text-ink-muted">Added {p.createdAt.toISOString().slice(0, 10)}</span>
                  </span>
                  {fresh ? <ActionForm action={removePasskeyAction} hidden={{ passkeyId: p.id }} label="Remove" variant="destructive" confirm="Remove this passkey?" /> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 max-w-sm">
            {fresh ? (
              <PasskeyButton purpose="add" size="md">
                Add a passkey on this device
              </PasskeyButton>
            ) : (
              <a href={confirm} className={buttonClass("secondary")}>
                Confirm it&apos;s you to make changes
              </a>
            )}
          </div>
        </Card>

        {providers.length ? (
          <Card>
            <h2 className="text-headline font-bold">Microsoft and Google</h2>
            <ul className="mt-3 divide-y divide-line">
              {providers.map((p) => {
                const linked = identities.find((i) => i.provider === p);
                const label = p === "GOOGLE" ? "Google" : "Microsoft";
                return (
                  <li key={p} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-semibold text-ink">{label}</span>
                      <span className="text-callout text-ink-muted">{linked ? `Linked as ${linked.email}` : "Not linked"}</span>
                    </span>
                    {linked ? (
                      fresh ? <ActionForm action={unlinkAction} hidden={{ provider: p }} label="Unlink" variant="destructive" /> : null
                    ) : (
                      <a href={`/auth/${p === "GOOGLE" ? "google" : "microsoft"}/start?intent=link`} className={buttonClass("secondary", "sm")}>
                        Link {label}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            {!fresh && identities.length ? (
              <p className="mt-3 text-callout">
                <a href={confirm} className="text-link underline underline-offset-4">
                  Confirm it&apos;s you
                </a>{" "}
                to unlink an account.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
