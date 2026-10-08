import type { Metadata } from "next";
import { acceptStaffInvitationAction } from "@/app/admin/(auth)/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { prisma } from "@/server/db";
import { STAFF_ROLE_DESCRIPTION, STAFF_ROLE_LABEL } from "@/server/staff/access";
import { findStaffInvitation } from "@/server/staff/staff";

export const metadata: Metadata = { title: "Staff invitation", robots: { index: false } };

export default async function StaffInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findStaffInvitation(prisma, token);
  if (!inv) {
    return (
      <AuthShell title="This invitation has ended">
        <p>It expired, was withdrawn or was already used. Ask an Admin for a new one.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Welcome, ${inv.name}`} lead={`You're invited to join the team as ${STAFF_ROLE_LABEL[inv.staffRole]}, with ${inv.email}.`}>
      <p className="text-callout text-ink-muted">{STAFF_ROLE_DESCRIPTION[inv.staffRole]}</p>
      <p className="mt-3 text-callout text-ink-muted">Next you add a passkey on this device. You use it every time you sign in.</p>
      <form action={acceptStaffInvitationAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">
          Set up my account
        </Button>
      </form>
    </AuthShell>
  );
}
