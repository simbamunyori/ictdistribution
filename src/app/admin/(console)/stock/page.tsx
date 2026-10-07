import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { countStockAction, saveWarehouseAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm, type FieldSpec } from "@/components/admin/spec-form";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listStock, listWarehouses, type WarehouseInput } from "@/server/logistics/stock";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Stock" };

type WarehouseValues = Omit<WarehouseInput, "active" | "isDefault"> & { active: boolean; isDefault: boolean };

const warehouseFields = (v: WarehouseValues): FieldSpec[] => [
  { kind: "text", id: "code", label: "Short code", hint: "Such as GBE.", defaultValue: v.code },
  { kind: "text", id: "name", label: "Name", defaultValue: v.name },
  { kind: "text", id: "country", label: "Country", hint: "Two letters, such as BW.", defaultValue: v.country },
  { kind: "textarea", id: "address", label: "Address suppliers deliver to", hint: "With a contact name and phone number. Printed on purchase orders.", defaultValue: v.address },
  { kind: "checkbox", id: "active", label: "In use", defaultChecked: v.active },
  { kind: "checkbox", id: "isDefault", label: "The default warehouse", hint: "Goods are bought into it and sent from it, and its country decides duty.", defaultChecked: v.isDefault },
];

export default async function Stock({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const canManage = staffCan(role, "manageStock");
  const warehouses = await listWarehouses(prisma);
  const warehouseId = warehouses.some((w) => w.id === q.warehouse) ? q.warehouse : undefined;
  const levels = await listStock(prisma, { warehouseId, q: q.q });
  return (
    <>
      <PageHeader title="Stock" lead="What is in our warehouses, and how much of it is kept for orders. Goods bought for an order are kept for it when they arrive, and leave with its delivery." />
      <div className="flex max-w-6xl flex-col gap-6">
        <form className="grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end" role="search">
          <label className="flex flex-col gap-1.5">
            <span className="text-callout font-semibold">Search</span>
            <input name="q" defaultValue={q.q} placeholder="Product name or part number" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-callout font-semibold">Warehouse</span>
            <select name="warehouse" defaultValue={warehouseId ?? ""} className={cn(inputClass, "pr-8")}>
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}, {w.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
            Show
          </button>
        </form>
        <Card>
          <h2 className="text-headline font-bold">Levels</h2>
          {levels.length ? (
            <TableWrap label="Stock levels">
              <table className="mt-3 w-full min-w-[52rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Product</th>
                    <th className={th}>Warehouse</th>
                    <th className={cn(th, "text-right")}>On hand</th>
                    <th className={cn(th, "text-right")}>Kept for orders</th>
                    <th className={cn(th, "text-right")}>Free</th>
                    {canManage ? <th className={th}>Count</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={l.id}>
                      <td className={td}>
                        <Link href={`/admin/products/${l.product.id}`} className="font-semibold text-link underline underline-offset-4">
                          {l.product.brand.name} {l.product.name}
                        </Link>
                        <span className="block text-caption text-ink-muted">{l.product.mpn}</span>
                      </td>
                      <td className={td}>{l.warehouse.code}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{l.onHand}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{l.allocated}</td>
                      <td className={cn(td, "text-right font-semibold tabular-nums")}>{l.onHand - l.allocated}</td>
                      {canManage ? (
                        <td className={td}>
                          <ActionForm action={countStockAction} hidden={{ warehouseId: l.warehouseId, productId: l.productId }} label="Save count">
                            <label className="flex flex-col gap-1">
                              <span className="sr-only">
                                Counted {l.product.name} in {l.warehouse.code}
                              </span>
                              <input name="count" inputMode="numeric" defaultValue={l.onHand} className={cn(inputClass, "h-9 w-20")} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="sr-only">Why the count changed</span>
                              <input name="note" placeholder="Why" className={cn(inputClass, "h-9 w-36")} />
                            </label>
                          </ActionForm>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2 text-callout text-ink-muted">Nothing in stock{q.q || warehouseId ? " matches" : " yet. Goods arrive here when purchase orders are received"}.</p>
          )}
        </Card>

        <h2 className="text-title font-bold">Warehouses</h2>
        {warehouses.map((w) => (
          <Card key={w.id}>
            <h3 className="mb-4 flex flex-wrap items-center gap-2 text-headline font-bold">
              {w.code}, {w.name}
              {w.isDefault ? <Badge tone="positive">Default</Badge> : null}
              {w.active ? null : <Badge>Not in use</Badge>}
            </h3>
            <SpecForm action={saveWarehouseAction} idPrefix={`w${w.id}-`} hidden={{ warehouseId: w.id }} fields={warehouseFields(w)} submitLabel="Save warehouse" variant="secondary" disabled={!canManage} />
          </Card>
        ))}
        {canManage ? (
          <Card>
            <h3 className="mb-4 text-headline font-bold">Add a warehouse</h3>
            <SpecForm action={saveWarehouseAction} idPrefix="new-" fields={warehouseFields({ code: "", name: "", country: "", address: "", active: true, isDefault: !warehouses.length })} submitLabel="Add warehouse" />
          </Card>
        ) : null}
      </div>
    </>
  );
}
