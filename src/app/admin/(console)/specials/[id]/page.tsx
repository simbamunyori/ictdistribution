import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { endSpecialAction } from "@/app/admin/(console)/shop-actions";
import { SpecialForm } from "@/components/admin/shop-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { SPECIAL_STATE_LABEL, specialState } from "@/server/shop/specials";
import { staffCan } from "@/server/staff/access";
import { specialFormOptions, specialValues } from "../form-data";

export const metadata: Metadata = { title: "Special" };

export default async function SpecialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const special = await prisma.special.findUnique({ where: { id }, include: { market: true, items: { include: { product: { select: { mpn: true } } }, orderBy: { productId: "asc" } } } });
  if (!special) notFound();
  const options = await specialFormOptions();
  const state = specialState(special);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/specials" className="text-link underline underline-offset-4">
          Specials
        </Link>
      </p>
      <PageHeader
        title={special.name}
        lead={
          <>
            <Badge tone={state === "running" ? "positive" : "neutral"}>{SPECIAL_STATE_LABEL[state]}</Badge>{" "}
            {special.quantityUsed} {special.quantityUsed === 1 ? "unit" : "units"} taken by orders{special.quantityLimit !== null ? ` of ${special.quantityLimit}` : ""}.
          </>
        }
        actions={
          canEdit && (state === "running" || state === "upcoming") ? (
            <ActionForm action={endSpecialAction} hidden={{ id: special.id }} label="End now" pendingLabel="Ending" variant="destructive" confirm="End this special now? It leaves the shop straight away." />
          ) : null
        }
      />
      {q.created ? (
        <Alert tone="positive" className="mb-6">
          Added. It shows in the shop from its start time.
        </Alert>
      ) : null}
      {q.launched ? (
        <Alert tone="positive" className="mb-6">
          Launched. The stock is recorded as ours and the special is on sale from its start time.
        </Alert>
      ) : null}
      <Card className="max-w-3xl">
        <SpecialForm special={specialValues(special)} readOnly={!canEdit} used={special.quantityUsed} {...options} />
      </Card>
    </>
  );
}
