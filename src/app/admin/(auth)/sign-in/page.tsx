import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { staffRequestCodeAction } from "@/app/admin/(auth)/actions";
import { AuthShell, OrRule } from "@/components/auth/auth-shell";
import { EmailForm } from "@/components/auth/forms";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { Alert } from "@/components/ui/alert";
import { currentSession, staffHomeFor } from "@/server/auth/next";
import { enabledProviders } from "@/server/auth/sign-in-options";

export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false } };

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "The sign-in was cancelled. Try again, or use your email.",
  failed: "That sign-in didn't work. Try again, or use your email.",
  expired: "That took too long. Start again.",
  busy: "Too many tries. Wait a few minutes and try again.",
  "no-email": "That Microsoft account didn't share an email address. Use your email instead.",
  unverified: "That Microsoft account's email isn't confirmed. Use your email instead.",
  deactivated: "Your staff account is switched off. Ask an Admin.",
  "unknown-staff": "There's no staff account for that Microsoft account. Ask an Admin to invite you.",
};

export default async function StaffSignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await currentSession("STAFF");
  if (session) redirect(staffHomeFor(session));
  const providers = enabledProviders("STAFF");
  return (
    <AuthShell
      title="Staff sign-in"
      lead="Your passkey signs you straight in. Otherwise use your work email or Microsoft, then your passkey."
      footer={
        <>
          Not staff? <Link href="/sign-in" className="text-link underline underline-offset-4">Customer sign-in</Link>
        </>
      }
    >
      {q.oauth && OAUTH_ERRORS[q.oauth] ? <Alert className="mb-5">{OAUTH_ERRORS[q.oauth]}</Alert> : null}
      {q.expired ? <Alert tone="warning" className="mb-5">That took too long. Start again.</Alert> : null}
      <div className="flex flex-col gap-3">
        <PasskeyButton purpose="sign-in" audience="STAFF" variant="primary">
          Sign in with your passkey
        </PasskeyButton>
        <ProviderButtons providers={providers} audience="STAFF" />
      </div>
      <OrRule />
      <EmailForm action={staffRequestCodeAction} label="Email me a code" />
    </AuthShell>
  );
}
