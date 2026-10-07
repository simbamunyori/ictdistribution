import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { deliveryWithOrder, serialsFor } from "@/server/logistics/deliveries";
import { deliveryNotePdf } from "@/server/logistics/documents";
import { pdfResponse } from "@/server/logistics/responses";
import { staffCan } from "@/server/staff/access";

/** A delivery note to print and pack with the goods. */
export async function GET(_: Request, { params }: { params: Promise<{ number: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewLogistics")) return new Response("Not found", { status: 404 });
  const d = await deliveryWithOrder(prisma, decodeURIComponent((await params).number));
  if (!d) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await deliveryNotePdf(d, await serialsFor(prisma, d.lines.map((l) => l.orderLineId)), { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Delivery-note-${d.number}.pdf`);
}
