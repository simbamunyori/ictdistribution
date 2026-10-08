import { currentSession } from "@/server/auth/next";
import { shipmentCsvTemplate } from "@/server/logistics/shipments";
import { staffCan } from "@/server/staff/access";

/** The CSV file to fill in with past shipments. */
export async function GET() {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewLogistics")) return new Response("Not found", { status: 404 });
  return new Response(shipmentCsvTemplate(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="past-shipments.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
