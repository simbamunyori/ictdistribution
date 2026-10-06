import { SiteFrame } from "@/components/site/site-frame";
import { AccountNav } from "@/components/account/account-nav";
import { requireCustomer } from "@/server/auth/next";
import { actorFor } from "@/server/accounts/organisations";
import { prisma } from "@/server/db";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCustomer("/account");
  const actor = await actorFor(prisma, session);
  return (
    <SiteFrame back="/account">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 md:grid-cols-[13rem_minmax(0,1fr)] md:px-6 md:py-12">
        <AccountNav organisation={Boolean(actor)} />
        <div className="min-w-0">{children}</div>
      </div>
    </SiteFrame>
  );
}
