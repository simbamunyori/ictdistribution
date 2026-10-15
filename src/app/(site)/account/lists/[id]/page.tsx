import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteListAction, listToCartAction } from "@/app/(site)/account/portal-actions";
import { ListLineForm, RenameListForm } from "@/components/account/portal-forms";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/server/db";
import { getList } from "@/server/portal/lists";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Saved list" };

export default async function ListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const v = await portalViewer(`/account/lists/${id}`);
  const list = await getList(prisma, v, id);
  if (!list) notFound();
  const buy = portalCan(v, "buy");
  return (
    <>
      <PageHeader
        title={list.name}
        lead={`${list.lines.length} ${list.lines.length === 1 ? "product" : "products"}${v.organisationId ? `, started by ${list.user.name}` : ""}. Prices are worked out when you put them in the cart.`}
        actions={
          buy && list.lines.length ? (
            <form action={listToCartAction}>
              <input type="hidden" name="listId" value={list.id} />
              <Button type="submit">Put it all in the cart</Button>
            </form>
          ) : null
        }
      />
      {q.problem ? <Alert className="mb-6">{q.problem}</Alert> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          {list.lines.length ? (
            <ul className="divide-y divide-line">
              {list.lines.map((l) => {
                const name = `${l.product.brand.name} ${l.product.name}`;
                return (
                  <li key={l.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <Link href={`/products/${l.product.slug}`} className="font-semibold text-link underline underline-offset-4">
                        {name}
                      </Link>
                      <span className="block text-callout text-ink-muted">
                        Part {l.product.mpn}
                        {l.product.status !== "ACTIVE" ? (
                          <>
                            {" "}
                            <Badge tone="warning">No longer sold</Badge>
                          </>
                        ) : null}
                      </span>
                    </span>
                    {buy ? <ListLineForm listId={list.id} lineId={l.id} quantity={l.quantity} label={name} /> : <span className="tabular-nums">{l.quantity}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>
              This list is empty. Open a product and choose Save to list.{" "}
              <Link href="/products" className="text-link underline underline-offset-4">
                Browse the range
              </Link>
            </p>
          )}
        </Card>
        {buy ? (
          <Card>
            <h2 className="text-headline font-bold">Change the list</h2>
            <div className="mt-3 flex flex-col gap-6">
              <RenameListForm listId={list.id} name={list.name} />
              <ActionForm action={deleteListAction} hidden={{ listId: list.id }} label="Delete this list" variant="destructive" confirm={`Delete ${list.name}? This can't be undone.`} />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
