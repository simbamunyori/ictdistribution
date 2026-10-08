import type { Metadata } from "next";
import Link from "next/link";
import { ReturnForm } from "@/components/account/portal-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { RETURN_REASON_LABEL, RETURN_REASONS, returnableLines } from "@/server/portal/returns";
import { inScope, portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Return items" };

export default async function NewReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const number = q.order ?? "";
  const v = await portalViewer(`/account/returns/new?order=${encodeURIComponent(number)}`);
  const found = number ? await prisma.order.findUnique({ where: { number }, select: { id: true, userId: true, organisationId: true, number: true, market: { select: { locale: true, timeZone: true } } } }) : null;
  const order = found && inScope(v, found) ? found : null;
  const r = order ? await returnableLines(prisma, order.id) : null;
  return (
    <>
      <PageHeader title="Return items" lead={order ? `From order ${order.number}.` : undefined} />
      <Card>
        {!order || !r ? (
          <p>
            Choose the order first.{" "}
            <Link href="/account/orders" className="text-link underline underline-offset-4">
              See your orders
            </Link>
          </p>
        ) : !portalCan(v, "buy") ? (
          <p>Your role doesn&apos;t allow asking for returns. Ask an Owner or a Buyer.</p>
        ) : !r.open ? (
          <p>Nothing from this order can be returned yet: items can be returned once they have left us.</p>
        ) : (
          <ReturnForm
            orderNumber={order.number}
            lines={r.lines.map((l) => ({ id: l.id, description: l.description, mpn: l.mpn, sent: l.sent, available: l.available }))}
            reasons={RETURN_REASONS.map((x) => ({ value: x, label: RETURN_REASON_LABEL[x] }))}
            window={r.changeOfMindOpen && r.closes ? `Any reason until ${formatDate(r.closes, order.market.locale, order.market.timeZone)}. A fault at any time.` : `The ${r.returnDays} days for any reason have passed. A fault can still be returned.`}
          />
        )}
      </Card>
    </>
  );
}
