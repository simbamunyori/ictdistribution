import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { staffSignOutAction } from "@/app/admin/(auth)/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { currentSession, staffHomeFor } from "@/server/auth/next";

export const metadata: Metadata = { title: "Add your passkey", robots: { index: false } };

export default async function SetupPasskey() {
  const session = await currentSession("STAFF");
  if (session?.stage !== "PASSKEY_SETUP") redirect(staffHomeFor(session));
  return (
    <AuthShell
      title="Add your passkey"
      lead={`Welcome, ${session.user.name}. Staff sign in with a passkey: your fingerprint, face or device PIN. Add one on the phone or computer you use for work.`}
      footer={
        <form action={staffSignOutAction}>
          <button type="submit" className="text-link underline underline-offset-4">
            Do this later
          </button>
        </form>
      }
    >
      <PasskeyButton purpose="setup" audience="STAFF" variant="primary" required>
        Add a passkey
      </PasskeyButton>
      <p className="mt-5 text-callout text-ink-muted">A passkey on your phone works on your computer too: choose to use a phone when your computer asks.</p>
    </AuthShell>
  );
}
