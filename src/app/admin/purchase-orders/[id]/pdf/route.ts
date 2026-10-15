import { DEFAULT_TIME_ZONE } from "@/config/app";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { purchaseOrderPdf } from "@/server/procurement/pdf";
import { SUPPLIER_PO_INCLUDE, SUPPLIER_PO_OMIT, poTerms } from "@/server/procurement/supplier";
import { staffCan } from "@/server/staff/access";

/** The purchase order's PDF as the supplier gets it, for staff. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewPurchaseOrders")) return new Response("Not found", { status: 404 });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: (await params).id }, include: SUPPLIER_PO_INCLUDE, omit: SUPPLIER_PO_OMIT });
  if (!po) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await purchaseOrderPdf(po, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, ...(await poTerms(prisma, po.id)), timeZone: DEFAULT_TIME_ZONE });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${po.number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
