import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { addShipmentPosAction, deleteShipmentAction, removeShipmentPoAction, shipmentStatusAction, updateShipmentAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { shipmentFields } from "@/components/logistics/shipment-fields";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { company } from "@/config/app";
import { cn } from "@/lib/cn";
import { SHIP_MODE_LABEL } from "@/lib/freight";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { logisticsSettings } from "@/server/logistics/landed";
import { getShipment, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, SHIPMENT_STATUSES, shipmentFormValues, shipmentPerKg } from "@/server/logistics/shipments";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "@/server/procurement/common";
import { staffWhen } from "@/server/quotes/common";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Shipment" };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const s = await getShipment(prisma, id).catch((e) => {
    if (e instanceof DomainError) return null;
    throw e;
  });
  if (!s) notFound();
  const canManage = staffCan(role, "manageShipments");
  const settings = await logisticsSettings(prisma);
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: s.currency }, company.staffLocale);
  const { chargeableGrams, perKg } = shipmentPerKg(s, settings);
  const total = s.freightMinor + s.insuranceMinor + s.dutiesMinor + s.clearingMinor + s.otherMinor;
  const live = s.source === "LIVE";
  const next = live && s.status !== "ARRIVED" ? SHIPMENT_STATUSES.slice(SHIPMENT_STATUSES.indexOf(s.status) + 1) : [];
  const hidden = { shipmentId: s.id };
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/logistics" className="text-link underline underline-offset-4">
          Shipments
        </Link>
      </p>
      <PageHeader
        title={`Shipment ${s.number}`}
        lead={
          <>
            <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge> {live ? "Live" : "Past"} {SHIP_MODE_LABEL[s.mode].toLowerCase()} shipment from {s.originCountry} to {s.destinationCountry}, recorded by {s.createdByLabel} {staffWhen(s.createdAt)}.
          </>
        }
      />
      <div className="flex max-w-5xl flex-col gap-6">
        <Card>
          <h2 className="text-headline font-bold">What it cost</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-callout sm:grid-cols-3">
            <div>
              <dt className="text-ink-muted">Chargeable weight</dt>
              <dd className="font-semibold tabular-nums">{(chargeableGrams / 1000).toLocaleString(company.staffLocale)} kg</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Freight per chargeable kg</dt>
              <dd className="font-semibold tabular-nums">{perKg ? money(perKg) : "No freight yet"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Everything</dt>
              <dd className="font-semibold tabular-nums">{money(total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-caption text-ink-muted">
            Volumetric weight uses {settings[`${s.mode.toLowerCase()}KgPerM3` as "airKgPerM3"]} kg per cubic metre for {SHIP_MODE_LABEL[s.mode].toLowerCase()}. {live && s.status !== "ARRIVED" ? "It counts towards the estimates once it arrives." : s.freightMinor > 0n ? "It counts towards the estimates for its route." : "Add its freight cost for it to count towards the estimates."}
          </p>
        </Card>

        {live ? (
          <Card>
            <h2 className="text-headline font-bold">Where it is</h2>
            {next.length && canManage ? (
              <>
                <p className="mt-1 mb-4 text-callout text-ink-muted">Moving it along moves its order lines too, and customers see the step. When it arrives, its purchase orders are received into the warehouse.</p>
                <div className="flex flex-wrap gap-3">
                  {next.map((st) => (
                    <ActionForm key={st} action={shipmentStatusAction} hidden={{ ...hidden, status: st }} label={st === "ARRIVED" ? "It arrived" : SHIPMENT_STATUS_LABEL[st]} size="md" variant={st === next[0] ? "primary" : "secondary"} confirm={st === "ARRIVED" ? "Mark it arrived and receive its purchase orders into the warehouse?" : undefined} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-callout text-ink-muted">{s.status === "ARRIVED" ? `Arrived${s.arrivedOn ? ` ${staffWhen(s.arrivedOn).split(",")[0]}` : ""}.` : SHIPMENT_STATUS_LABEL[s.status]}</p>
            )}
          </Card>
        ) : null}

        {live ? (
          <Card>
            <h2 className="text-headline font-bold">Purchase orders in it</h2>
            {s.purchaseOrders.length ? (
              <TableWrap label="Purchase orders in this shipment">
                <table className="mt-3 w-full min-w-[40rem] text-callout">
                  <thead>
                    <tr>
                      <th className={th}>Purchase order</th>
                      <th className={th}>Supplier</th>
                      <th className={th}>For order</th>
                      <th className={th}>Status</th>
                      {canManage && s.status !== "ARRIVED" ? <th className={cn(th, "sr-only")}>Take off</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {s.purchaseOrders.map((p) => (
                      <tr key={p.id}>
                        <td className={td}>
                          <Link href={`/admin/purchase-orders/${p.id}`} className="font-semibold text-link underline underline-offset-4">
                            {p.number}
                          </Link>
                        </td>
                        <td className={td}>{p.supplier.name}</td>
                        <td className={td}>
                          <Link href={`/admin/orders/${p.order.id}`} className="text-link underline underline-offset-4">
                            {p.order.number}
                          </Link>
                        </td>
                        <td className={td}>
                          <Badge tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge>
                        </td>
                        {canManage && s.status !== "ARRIVED" ? (
                          <td className={td}>
                            <ActionForm action={removeShipmentPoAction} hidden={{ ...hidden, poId: p.id }} label={`Take ${p.number} off`} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="mt-2 text-callout text-ink-muted">None yet.</p>
            )}
            {canManage && s.status !== "ARRIVED" ? (
              <div className="mt-4">
                <SpecForm action={addShipmentPosAction} hidden={hidden} fields={[{ kind: "text", id: "numbers", label: "Purchase order numbers", hint: "Separate them with spaces or commas. Only ones with the supplier, and not delivered straight to the customer.", wide: true }]} submitLabel="Add to shipment" variant="secondary" />
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-4 text-headline font-bold">{canManage ? "Details and costs" : "Details"}</h2>
          <SpecForm action={updateShipmentAction} hidden={hidden} fields={shipmentFields(shipmentFormValues(s))} submitLabel="Save changes" pendingLabel="Saving" disabled={!canManage} />
        </Card>

        {canManage && !live ? (
          <Card>
            <h2 className="mb-1 text-headline font-bold">Remove it</h2>
            <p className="mb-4 text-callout text-ink-muted">For a mistake or a demo sample. The estimates are worked out again without it.</p>
            <ActionForm action={deleteShipmentAction} hidden={hidden} label="Remove shipment" variant="destructive" size="md" confirm={`Remove shipment ${s.number}?`} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
