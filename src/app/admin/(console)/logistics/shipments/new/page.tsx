import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { recordShipmentAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { shipmentFields } from "@/components/logistics/shipment-fields";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { homeCountry } from "@/server/logistics/landed";
import { EMPTY_SHIPMENT } from "@/server/logistics/shipments";
import { pricingSettings } from "@/server/pricing/rates";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "New shipment" };

export default async function NewShipment({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageShipments")) redirect("/admin/logistics");
  const live = q.source === "LIVE";
  const [home, base] = await Promise.all([homeCountry(prisma), pricingSettings(prisma).then((p) => p.baseCurrency)]);
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/logistics" className="text-link underline underline-offset-4">
          Shipments
        </Link>
      </p>
      <PageHeader
        title={live ? "Book a shipment" : "Record a past shipment"}
        lead={live ? "A consignment on its way to us. Add its purchase orders next, then move it along as it travels. Its costs can be filled in when the invoices arrive." : "A consignment that has arrived. Its costs per kilogram feed the freight estimates for its route straight away."}
      />
      <Card className="max-w-4xl">
        <SpecForm action={recordShipmentAction} hidden={{ source: live ? "LIVE" : "HISTORY" }} fields={shipmentFields({ ...EMPTY_SHIPMENT, destinationCountry: home, currency: base })} submitLabel={live ? "Book shipment" : "Record shipment"} pendingLabel="Saving" />
      </Card>
    </>
  );
}
