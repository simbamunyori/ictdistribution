import type { ShipmentSource, ShipmentStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogisticsNav } from "@/components/logistics/logistics-nav";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { company } from "@/config/app";
import { cn } from "@/lib/cn";
import { SHIP_MODE_LABEL } from "@/lib/freight";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { listShipments, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, SHIPMENT_STATUSES } from "@/server/logistics/shipments";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Shipments" };

export default async function Shipments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const source = q.source === "HISTORY" || q.source === "LIVE" ? (q.source as ShipmentSource) : undefined;
  const status = SHIPMENT_STATUSES.includes(q.status as ShipmentStatus) ? (q.status as ShipmentStatus) : undefined;
  const shipments = await listShipments(prisma, { source, status, q: q.q });
  const canManage = staffCan(role, "manageShipments");
  return (
    <>
      <PageHeader
        title="Shipments"
        lead="Every consignment we bring in. Past shipments teach the freight estimates; live ones carry purchase orders and move their order lines along."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-3">
              <Link href="/admin/logistics/shipments/new?source=LIVE" className="inline-flex h-11 items-center rounded-md bg-brand px-4 font-semibold text-on-brand">
                Book a shipment
              </Link>
              <Link href="/admin/logistics/shipments/new?source=HISTORY" className="inline-flex h-11 items-center rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
                Record a past shipment
              </Link>
            </div>
          ) : null
        }
      />
      <LogisticsNav current="/admin/logistics" />
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_12rem_12rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Shipment, waybill, carrier or origin country" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Kind</span>
          <select name="source" defaultValue={source ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Past and live</option>
            <option value="LIVE">Live</option>
            <option value="HISTORY">Past</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SHIPMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        {shipments.length ? (
          <TableWrap label="Shipments">
            <table className="w-full min-w-[52rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Shipment</th>
                  <th className={th}>Route</th>
                  <th className={cn(th, "text-right")}>Weight</th>
                  <th className={cn(th, "text-right")}>Cost</th>
                  <th className={th}>Dates</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/admin/logistics/shipments/${s.id}`} className="font-semibold text-link underline underline-offset-4">
                        {s.number}
                      </Link>
                      <span className="block text-caption text-ink-muted">
                        {s.source === "HISTORY" ? "Past" : `Live, ${s._count.purchaseOrders} purchase ${s._count.purchaseOrders === 1 ? "order" : "orders"}`}
                        {s.reference ? `, ${s.reference}` : ""}
                      </span>
                    </td>
                    <td className={td}>
                      {SHIP_MODE_LABEL[s.mode]} {s.originCountry} to {s.destinationCountry}
                      {s.carrier ? <span className="block text-caption text-ink-muted">{s.carrier}</span> : null}
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>{(s.weightGrams / 1000).toLocaleString(company.staffLocale)} kg</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatMoney({ amountMinor: s.freightMinor + s.insuranceMinor + s.dutiesMinor + s.clearingMinor + s.otherMinor, currency: s.currency }, company.staffLocale)}</td>
                    <td className={td}>
                      {s.shippedOn ? staffWhen(s.shippedOn).split(",")[0] : "Not shipped"}
                      {s.arrivedOn ? <span className="block text-caption text-ink-muted">Arrived {staffWhen(s.arrivedOn).split(",")[0]}</span> : s.transitDays !== null ? <span className="block text-caption text-ink-muted">{s.transitDays} days</span> : null}
                    </td>
                    <td className={td}>
                      <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No shipments match. Record past shipments so freight can be estimated.</p>
        )}
      </Card>
    </>
  );
}
