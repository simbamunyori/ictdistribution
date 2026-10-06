import type { Metadata } from "next";
import { ConfirmByEmail } from "@/components/account/forms";
import { OrRule } from "@/components/auth/auth-shell";
import { PasskeyButton } from "@/components/auth/passkey-button";
import { Card, PageHeader } from "@/components/ui/card";
import { requireCustomer, safeNext } from "@/server/auth/next";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Confirm it's you" };

export default async function Confirm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next, "/account");
  const session = await requireCustomer("/account/confirm");
  const hasPasskey = (await prisma.passkey.count({ where: { userId: session.userId } })) > 0;
  return (
    <>
      <PageHeader title="Confirm it's you" lead="Changes to how you sign in need a quick check. It lasts 15 minutes." />
      <Card className="max-w-md">
        {hasPasskey ? (
          <PasskeyButton purpose="step-up" next={next} variant="primary" after={<OrRule />}>
            Use your passkey
          </PasskeyButton>
        ) : null}
        <ConfirmByEmail next={next} email={session.user.email} />
      </Card>
    </>
  );
}
