import { DEFAULT_TIME_ZONE } from "@/config/app";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { purchaseOrderPdf } from "@/server/procurement/pdf";
import { poByToken, poTerms } from "@/server/procurement/supplier";

/** The purchase order as a PDF, for the supplier's link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const po = await poByToken(prisma, token);
  if (!po) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await purchaseOrderPdf(po, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, token, ...(await poTerms(prisma, po.id)), timeZone: DEFAULT_TIME_ZONE });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
