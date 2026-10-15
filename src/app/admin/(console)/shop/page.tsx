import type { Metadata } from "next";
import Link from "next/link";
import { moveFeaturedUpAction, removeFeaturedAction } from "@/app/admin/(console)/shop-actions";
import { AddFeaturedForm, ShopSettingsForm } from "@/components/admin/shop-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { featuredForAdmin, shopSettings } from "@/server/shop/settings";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Shop" };

export default async function Shop() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const [settings, featured, markets] = await Promise.all([shopSettings(prisma), featuredForAdmin(prisma), prisma.market.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } })]);
  return (
    <>
      <PageHeader title="Shop" lead="The home page, and how orders work. Specials have their own page; delivery, collection, tax and bank details are set per market." />
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <h2 className="mb-4 text-headline font-bold">Popular now, on the home page</h2>
          {featured.length ? (
            <ol className="mb-5 flex flex-col divide-y divide-line rounded-md border border-line">
              {featured.map((f, i) => (
                <li key={f.productId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <Link href={`/admin/products/${f.product.id}`} className="font-semibold text-link underline underline-offset-4">
                      {f.product.brand.name} {f.product.name}
                    </Link>
                    <span className="block text-caption text-ink-muted">{f.product.mpn}</span>
                    {f.product.status !== "ACTIVE" ? <Badge tone="warning">Not in the shop, so hidden</Badge> : null}
                  </span>
                  {canEdit ? (
                    <span className="flex gap-2">
                      {i > 0 ? <ActionForm action={moveFeaturedUpAction} hidden={{ productId: f.productId }} label="Move up" /> : null}
                      <ActionForm action={removeFeaturedAction} hidden={{ productId: f.productId }} label="Remove" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mb-5 text-ink-muted">Nothing chosen. The section is hidden until you add a product.</p>
          )}
          {canEdit ? <AddFeaturedForm /> : null}
          <p className="mt-4 text-callout text-ink-muted">
            Specials marked Show on the home page appear above this list.{" "}
            <Link href="/admin/specials" className="text-link underline underline-offset-4">
              Specials
            </Link>
          </p>
        </Card>
        <Card>
          <h2 className="mb-4 text-headline font-bold">Home page and orders</h2>
          <ShopSettingsForm readOnly={!canEdit} settings={{ heroTitle: settings.heroTitle, heroText: settings.heroText, payDays: String(settings.payDays), maxLineQuantity: String(settings.maxLineQuantity) }} />
        </Card>
        <Card>
          <h2 className="text-headline font-bold">Selling in each market</h2>
          <p className="mt-1 text-callout text-ink-muted">Delivery fees, collection points, tax and bank details.</p>
          <ul className="mt-3 flex flex-wrap gap-3">
            {markets.map((m) => (
              <li key={m.code}>
                <Link href={`/admin/markets/${m.code}#selling`} className="font-semibold text-link underline underline-offset-4">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
