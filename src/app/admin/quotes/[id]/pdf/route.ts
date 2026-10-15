import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { CUSTOMER_QUOTE_INCLUDE, CUSTOMER_QUOTE_OMIT } from "@/server/quotes/customer";
import { quotePdf } from "@/server/quotes/pdf";
import { staffCan } from "@/server/staff/access";

/** The quote's PDF as the customer gets it, for staff to check before and after sending. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewQuotes")) return new Response("Not found", { status: 404 });
  const quote = await prisma.quote.findUnique({ where: { id: (await params).id }, include: CUSTOMER_QUOTE_INCLUDE, omit: CUSTOMER_QUOTE_OMIT });
  if (!quote || quote.subtotalMinor === null) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await quotePdf(quote, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Quote-${quote.number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
