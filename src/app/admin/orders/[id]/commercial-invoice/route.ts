import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { commercialInvoicePdf } from "@/server/logistics/documents";
import { pdfResponse } from "@/server/logistics/responses";
import { staffCan } from "@/server/staff/access";

/** The commercial invoice for customs, for staff. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewOrders")) return new Response("Not found", { status: 404 });
  const order = await prisma.order.findUnique({ where: { id: (await params).id }, include: { lines: { orderBy: { sortOrder: "asc" } }, market: true } });
  if (!order) return new Response("Not found", { status: 404 });
  return pdfResponse(await commercialInvoicePdf(prisma, order, { legalName: env().COMPANY_LEGAL_NAME }), `Commercial-invoice-${order.number}.pdf`);
}
