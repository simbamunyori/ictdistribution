import type { Metadata } from "next";
import { CustomerTypeForm } from "@/components/admin/forms";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCustomerTypes } from "@/server/pricing/customer-types";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Price levels" };

export default async function CustomerTypes() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "managePriceLevels");
  const types = await listCustomerTypes(prisma);
  return (
    <>
      <PageHeader
        title="Price levels"
        lead="Each customer type pays our cost plus its markup, converted into their market's currency. Product categories and specials refine this in later milestones."
      />
      {!canEdit ? (
        <Alert tone="info" className="mb-6">
          Only an Admin can change price levels.
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {types.map((t) => (
          <Card key={t.code}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-headline font-bold">{t.name}</h2>
              <Badge tone={t.organisation ? "neutral" : "positive"}>{t.organisation ? "Organisation" : "One person"}</Badge>
            </div>
            <CustomerTypeForm
              readOnly={!canEdit}
              type={{ code: t.code, name: t.name, description: t.description, markupPercent: (t.markupBps / 100).toString(), guestCheckout: t.guestCheckout, organisation: t.organisation }}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
