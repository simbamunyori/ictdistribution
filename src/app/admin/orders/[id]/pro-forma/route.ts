import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { proFormaPdf } from "@/server/shop/pro-forma";
import { staffCan } from "@/server/staff/access";

/** The order's pro forma invoice as the customer gets it, for staff. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewOrders")) return new Response("Not found", { status: 404 });
  const order = await prisma.order.findUnique({ where: { id: (await params).id }, include: { lines: { orderBy: { sortOrder: "asc" } }, market: true } });
  if (!order) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await proFormaPdf(order, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Pro-forma-${order.number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
