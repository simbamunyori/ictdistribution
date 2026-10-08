import type { Metadata } from "next";
import Link from "next/link";
import { CreateListForm } from "@/components/account/portal-forms";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { listsFor } from "@/server/portal/lists";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Saved lists" };

export default async function ListsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const v = await portalViewer("/account/lists");
  const [lists, { market }] = await Promise.all([listsFor(prisma, v), shopper()]);
  return (
    <>
      <PageHeader title="Saved lists" lead={v.organisationId ? "Products your team buys again and again, shared with everyone on it. Put a whole list in the cart in one go." : "Products you buy again and again. Put a whole list in the cart in one go."} />
      {q.deleted ? (
        <div role="status" className="mb-6">
          <Alert tone="positive">List deleted.</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {lists.length ? (
          <ul className="flex flex-col gap-3">
            {lists.map((l) => (
              <li key={l.id}>
                <Link href={`/account/lists/${l.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised p-4 hover:border-brand">
                  <span>
                    <span className="block font-bold text-ink">{l.name}</span>
                    <span className="text-callout text-ink-muted">
                      {l._count.lines} {l._count.lines === 1 ? "product" : "products"}, changed {formatDate(l.updatedAt, market.locale, market.timeZone)}
                      {v.organisationId ? `, started by ${l.user.name}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <p>No lists yet. Save products to a list from their page, or save your cart or a past order as a list.</p>
          </Card>
        )}
        {portalCan(v, "buy") ? (
          <Card>
            <h2 className="text-headline font-bold">Start a list</h2>
            <div className="mt-3">
              <CreateListForm />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
