import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listSpecials, SPECIAL_KIND_LABEL, SPECIAL_STATE_LABEL, specialState } from "@/server/shop/specials";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Specials" };

const TONE = { running: "positive", upcoming: "highlight", ended: "neutral", "sold-out": "warning", off: "neutral" } as const;

export default async function Specials() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const specials = await listSpecials(prisma);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Specials"
        lead="Lower prices for a while, on a product, a category or a bundle. Customers see a countdown, and limited units stop when they are sold."
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/admin/specials/consignment" variant="secondary">
                Launch stock as a special
              </ButtonLink>
              <ButtonLink href="/admin/specials/new">Add special</ButtonLink>
            </div>
          ) : null
        }
      />
      <Card>
        {specials.length ? (
          <TableWrap label="Specials">
            <table className="w-full min-w-[48rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Special</th>
                  <th className={th}>Discount</th>
                  <th className={th}>Runs</th>
                  <th className={th}>Units taken</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {specials.map((s) => {
                  const state = specialState(s, now);
                  const on = s.kind === "CATEGORY" ? s.category?.name : s.items.map((i) => `${i.quantity > 1 ? `${i.quantity} x ` : ""}${i.product.brand.name} ${i.product.name}`).join(", ");
                  return (
                    <tr key={s.id}>
                      <td className={td}>
                        <Link href={`/admin/specials/${s.id}`} className="font-semibold text-link underline underline-offset-4">
                          {s.name}
                        </Link>
                        <span className="block text-caption text-ink-muted">
                          {SPECIAL_KIND_LABEL[s.kind]}: {on}
                        </span>
                      </td>
                      <td className={cn(td, "tabular-nums")}>{s.priceMinor !== null && s.market ? `${formatMoney({ amountMinor: s.priceMinor, currency: s.market.currency }, s.market.locale)} in ${s.market.name}` : `${(s.discountBps ?? 0) / 100}% off${s.market ? ` in ${s.market.name}` : ""}`}</td>
                      <td className={td}>
                        {formatDateTime(s.startsAt, "en-BW", DEFAULT_TIME_ZONE)}
                        <span className="block text-ink-muted">to {formatDateTime(s.endsAt, "en-BW", DEFAULT_TIME_ZONE)}</span>
                      </td>
                      <td className={cn(td, "tabular-nums")}>
                        {s.quantityUsed}
                        {s.quantityLimit !== null ? ` of ${s.quantityLimit}` : ""}
                      </td>
                      <td className={td}>
                        <Badge tone={TONE[state]}>{SPECIAL_STATE_LABEL[state]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No specials yet.</p>
        )}
      </Card>
    </>
  );
}
