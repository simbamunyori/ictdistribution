import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, OrRule } from "@/components/auth/auth-shell";
import { EmailForm } from "@/components/auth/forms";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { Alert } from "@/components/ui/alert";
import { currentSession, safeNext } from "@/server/auth/next";
import { enabledProviders } from "@/server/auth/sign-in-options";

export const metadata: Metadata = { title: "Sign in" };

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "The sign-in was cancelled. Try again, or use your email.",
  failed: "That sign-in didn't work. Try again, or use your email.",
  expired: "That took too long. Start again.",
  busy: "Too many tries. Wait a few minutes and try again.",
  "no-email": "That account didn't share an email address with us. Use your email instead.",
  unverified: "That account's email isn't confirmed, so we can't use it. Use your email instead.",
  deactivated: "This account is switched off. Contact us if you think that's a mistake.",
  "wrong-door": "That account belongs to our staff. Staff sign in at /admin.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = safeNext(q.next, "");
  const session = await currentSession("CUSTOMER");
  if (session?.stage === "ACTIVE") redirect(next || "/account");
  const providers = enabledProviders("CUSTOMER");
  return (
    <AuthShell
      title="Sign in or create an account"
      lead="One step, whichever way suits you."
      footer={
        <>
          Staff? <Link href="/admin/sign-in" className="text-link underline underline-offset-4">Staff sign-in</Link>
        </>
      }
    >
      {q.oauth && OAUTH_ERRORS[q.oauth] ? <Alert className="mb-5">{OAUTH_ERRORS[q.oauth]}</Alert> : null}
      {q.expired ? <Alert tone="warning" className="mb-5">That took too long. Start again.</Alert> : null}
      <div className="flex flex-col gap-3">
        <ProviderButtons providers={providers} next={next || undefined} />
        <PasskeyButton purpose="sign-in" next={next || undefined}>
          Sign in with a passkey
        </PasskeyButton>
      </div>
      <OrRule />
      <EmailForm next={next || undefined} />
    </AuthShell>
  );
}
