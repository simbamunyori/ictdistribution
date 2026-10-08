import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { invoiceByToken, invoiceForViewer, invoicePdf } from "@/server/portal/invoices";
import { shopper } from "@/server/shop/viewer";

/** A tax invoice as a PDF, for the emailed link or anyone signed in who may see it. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const byLink = token ? await invoiceByToken(prisma, number, token) : null;
  const s = byLink ? null : await shopper();
  const inv = byLink ?? (s?.user ? await invoiceForViewer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!inv) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await invoicePdf(inv, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Invoice-${inv.number}.pdf`);
}
