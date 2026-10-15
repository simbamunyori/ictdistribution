import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { orderByToken, orderForCustomer } from "@/server/shop/orders";
import { proFormaPdf } from "@/server/shop/pro-forma";
import { shopper } from "@/server/shop/viewer";

/** The order's pro forma invoice as a PDF, for the emailed link or its signed-in customer. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const s = await shopper();
  const byLink = token ? await orderByToken(prisma, number, token) : null;
  const order = byLink ?? (s.user ? await orderForCustomer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!order) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await proFormaPdf(order, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, token: byLink ? token : undefined });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Pro-forma-${order.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
