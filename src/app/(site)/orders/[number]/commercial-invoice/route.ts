import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { commercialInvoicePdf } from "@/server/logistics/documents";
import { pdfResponse } from "@/server/logistics/responses";
import { viewableOrder } from "@/server/shop/viewer";

/** The commercial invoice for customs, once the order has started to leave. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const seen = await viewableOrder(number, new URL(request.url).searchParams.get("t") ?? "");
  if (!seen || seen.order.fulfilment !== "DELIVERY" || seen.order.status === "CANCELLED") return new Response("Not found", { status: 404 });
  return pdfResponse(await commercialInvoicePdf(prisma, seen.order, { legalName: env().COMPANY_LEGAL_NAME }), `Commercial-invoice-${seen.order.number}.pdf`);
}
