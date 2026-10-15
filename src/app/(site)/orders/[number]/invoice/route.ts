import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { INVOICE_INCLUDE, invoicePdf } from "@/server/portal/invoices";
import { viewableOrder } from "@/server/shop/viewer";

/** The order's tax invoice as a PDF, for the order's emailed link or its signed-in customer. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const seen = await viewableOrder(number, new URL(request.url).searchParams.get("t") ?? "");
  const inv = seen ? await prisma.invoice.findUnique({ where: { orderId: seen.order.id }, include: INVOICE_INCLUDE }) : null;
  if (!inv) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await invoicePdf(inv, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Invoice-${inv.number}.pdf`);
}
