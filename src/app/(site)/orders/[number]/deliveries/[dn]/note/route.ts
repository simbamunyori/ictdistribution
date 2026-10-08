import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { deliveryWithOrder, serialsFor } from "@/server/logistics/deliveries";
import { deliveryNotePdf } from "@/server/logistics/documents";
import { pdfResponse } from "@/server/logistics/responses";
import { viewableOrder } from "@/server/shop/viewer";

/** A delivery's note, for the order's emailed link or its signed-in customer. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string; dn: string }> }) {
  const { number, dn } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const seen = await viewableOrder(number, token);
  const d = seen ? await deliveryWithOrder(prisma, dn) : null;
  if (!seen || !d || d.orderId !== seen.order.id) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await deliveryNotePdf(d, await serialsFor(prisma, d.lines.map((l) => l.orderLineId)), { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, token: seen.byLink ? token : undefined }), `Delivery-note-${d.number}.pdf`);
}
