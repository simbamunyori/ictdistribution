import type { Metadata } from "next";
import Link from "next/link";
import { acceptInvitationAction } from "@/app/(site)/account/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { findInvitation } from "@/server/accounts/organisations";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { ORG_ROLE_LABEL } from "@/server/org/access";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvitation(prisma, token);
  if (!inv) {
    return (
      <AuthShell title="This invitation has ended">
        <p>It expired, was withdrawn or was already used. Ask the person who invited you for a new one.</p>
      </AuthShell>
    );
  }
  const session = await currentSession("CUSTOMER");
  const signedIn = session?.stage === "ACTIVE";
  const here = `/invite/${token}`;
  return (
    <AuthShell title={`Join ${inv.organisation.name}`} lead={`You're invited as ${ORG_ROLE_LABEL[inv.role]}, with ${inv.email}.`}>
      {signedIn && session.user.email !== inv.email ? (
        <Alert tone="warning" className="mb-5">
          You&apos;re signed in as {session.user.email}. Sign out, then sign in with {inv.email} to accept.
        </Alert>
      ) : null}
      {signedIn && session.user.email === inv.email ? (
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" className="w-full">
            Accept and join
          </Button>
        </form>
      ) : !signedIn ? (
        <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonClass("primary", "lg", "w-full")}>
          Sign in or create your account
        </Link>
      ) : null}
    </AuthShell>
  );
}
