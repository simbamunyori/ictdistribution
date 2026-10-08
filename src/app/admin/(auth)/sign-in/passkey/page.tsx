import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { staffSignOutAction } from "@/app/admin/(auth)/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { currentSession, staffHomeFor } from "@/server/auth/next";

export const metadata: Metadata = { title: "Use your passkey", robots: { index: false } };

export default async function StaffPasskey() {
  const session = await currentSession("STAFF");
  if (session?.stage !== "PASSKEY_PENDING") redirect(staffHomeFor(session));
  return (
    <AuthShell
      title="Use your passkey"
      lead={`Signed in as ${session.user.email}. Staff finish every sign-in with their passkey.`}
      footer={
        <form action={staffSignOutAction}>
          <button type="submit" className="text-link underline underline-offset-4">
            Start again
          </button>
        </form>
      }
    >
      <PasskeyButton purpose="second-step" audience="STAFF" variant="primary" required>
        Use your passkey
      </PasskeyButton>
      <p className="mt-5 text-callout text-ink-muted">Lost the device with your passkey? Ask an Admin to switch your account off and invite you again.</p>
    </AuthShell>
  );
}
