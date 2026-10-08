import type { Metadata } from "next";
import { staffConfirmCodeAction, staffSendConfirmCodeAction } from "@/app/admin/(console)/actions";
import { ConfirmByEmail } from "@/components/account/forms";
import { OrRule } from "@/components/auth/auth-shell";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff, safeNext } from "@/server/auth/next";

export const metadata: Metadata = { title: "Confirm it's you" };

export default async function StaffConfirm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next, "/admin/account");
  const session = await requireStaff();
  return (
    <>
      <PageHeader title="Confirm it's you" lead="Changes to how you sign in need a quick check. It lasts 15 minutes." />
      <Card className="max-w-md">
        <PasskeyButton purpose="step-up" audience="STAFF" next={next} variant="primary" after={<OrRule />}>
          Use your passkey
        </PasskeyButton>
        <ConfirmByEmail next={next} email={session.user.email} sendAction={staffSendConfirmCodeAction} confirmAction={staffConfirmCodeAction} />
      </Card>
    </>
  );
}
