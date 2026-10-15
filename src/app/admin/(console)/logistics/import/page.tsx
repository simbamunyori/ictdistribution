import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { importShipmentsAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { LogisticsNav } from "@/components/logistics/logistics-nav";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { SHIPMENT_CSV_COLUMNS } from "@/server/logistics/shipments";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Load past shipments" };

export default async function ImportShipments() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const canManage = staffCan(role, "manageShipments");
  return (
    <>
      <PageHeader title="Load past shipments" lead="Bring in your shipment records from a spreadsheet, so freight can be estimated from what you actually paid." />
      <LogisticsNav current="/admin/logistics/import" />
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <h2 className="text-headline font-bold">1. Fill in the template</h2>
          <p className="mt-2 text-callout">
            <a href="/admin/logistics/template" className="font-semibold text-link underline underline-offset-4">
              Download the template
            </a>{" "}
            and add one row per shipment. Save it as CSV.
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-callout">
            <li>Mode is AIR, SEA, ROAD or COURIER. Countries are two letters, such as ZA and BW.</li>
            <li>Weight is the gross weight in kilograms. Volume, in cubic metres, is optional and used for volumetric weight.</li>
            <li>Amounts are in the currency of the row, without the currency sign. Dates are written 2026-03-31.</li>
            <li>Only mode, the two countries, weight, currency and freight are needed. Leave the rest empty when you don&apos;t know them.</li>
          </ul>
          <p className="mt-3 text-caption break-words text-ink-muted">Columns: {SHIPMENT_CSV_COLUMNS.join(", ")}</p>
        </Card>
        <Card>
          <h2 className="mb-4 text-headline font-bold">2. Load it</h2>
          <SpecForm action={importShipmentsAction} fields={[{ kind: "file", id: "file", label: "CSV file", accept: ".csv,text/csv", hint: "Up to 2000 rows. If any row has a problem, nothing is loaded and every problem is listed.", wide: true }]} submitLabel="Load shipments" pendingLabel="Loading" disabled={!canManage} />
        </Card>
      </div>
    </>
  );
}
