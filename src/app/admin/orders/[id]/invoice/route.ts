import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { INVOICE_INCLUDE, invoicePdf } from "@/server/portal/invoices";
import { staffCan } from "@/server/staff/access";

/** The order's tax invoice as the customer gets it, for staff. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewOrders")) return new Response("Not found", { status: 404 });
  const inv = await prisma.invoice.findUnique({ where: { orderId: (await params).id }, include: INVOICE_INCLUDE });
  if (!inv) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await invoicePdf(inv, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Invoice-${inv.number}.pdf`);
}
