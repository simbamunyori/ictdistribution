import type { Metadata } from "next";
import { removeCategoryMarkupAction, removeVolumeBreakAction } from "@/app/admin/(console)/business-actions";
import { CategoryMarkupForm, VolumeBreakForm } from "@/components/admin/business-forms";
import { CustomerTypeForm } from "@/components/admin/forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listCustomerTypes } from "@/server/pricing/customer-types";
import { levelRules } from "@/server/pricing/levels";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Price levels" };

const pct = (bps: number) => `${bps / 100}%`;

export default async function CustomerTypes() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "managePriceLevels");
  const [types, categories] = await Promise.all([listCustomerTypes(prisma), prisma.category.findMany({ select: { id: true, name: true, parent: { select: { name: true } } }, orderBy: { name: "asc" } })]);
  const rules = await Promise.all(types.map((t) => levelRules(prisma, t.code)));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name}: ${c.name}` : c.name })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <>
      <PageHeader
        title="Price levels"
        lead="Each customer type pays our cost plus its markup, converted into their market's currency. A category can have its own markup, and volume breaks take a percentage off for buying more. Businesses buy at their level once we have checked them."
      />
      {!canEdit ? (
        <Alert tone="info" className="mb-6">
          Only an Admin can change price levels.
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {types.map((t, i) => {
          const { markups, breaks } = rules[i];
          return (
            <Card key={t.code}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-headline font-bold">{t.name}</h2>
                <Badge tone={t.organisation ? "neutral" : "positive"}>{t.organisation ? "Organisation" : "One person"}</Badge>
              </div>
              <CustomerTypeForm
                readOnly={!canEdit}
                type={{ code: t.code, name: t.name, description: t.description, markupPercent: (t.markupBps / 100).toString(), guestCheckout: t.guestCheckout, organisation: t.organisation }}
              />

              <h3 className="mt-8 border-t border-line pt-6 font-bold">Markup by category</h3>
              <p className="mt-1 text-callout text-ink-muted">In place of {pct(t.markupBps)} for these categories and the ones under them.</p>
              {markups.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {markups.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span>
                        {m.category.parent ? `${m.category.parent.name}: ` : ""}
                        {m.category.name} <span className="font-semibold tabular-nums">{pct(m.markupBps)}</span>
                      </span>
                      {canEdit ? <ActionForm action={removeCategoryMarkupAction} hidden={{ id: m.id }} label="Remove" variant="ghost" /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-callout">None. Every category uses {pct(t.markupBps)}.</p>
              )}
              {canEdit ? (
                <div className="mt-4">
                  <CategoryMarkupForm type={t.code} categories={categoryOptions} />
                </div>
              ) : null}

              <h3 className="mt-8 border-t border-line pt-6 font-bold">Volume breaks</h3>
              <p className="mt-1 text-callout text-ink-muted">A percentage off each unit when buying at least this many of one product. Not on top of specials or agreed prices.</p>
              {breaks.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {breaks.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span>
                        {b.minQuantity} or more{b.category ? ` in ${b.category.name}` : ""}: <span className="font-semibold tabular-nums">{pct(b.discountBps)} off</span>
                      </span>
                      {canEdit ? <ActionForm action={removeVolumeBreakAction} hidden={{ id: b.id }} label="Remove" variant="ghost" /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-callout">None.</p>
              )}
              {canEdit ? (
                <div className="mt-4">
                  <VolumeBreakForm type={t.code} categories={categoryOptions} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
