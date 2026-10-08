import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { quoteByToken, quoteForCustomer } from "@/server/quotes/customer";
import { quotePdf } from "@/server/quotes/pdf";
import { shopper } from "@/server/shop/viewer";

/** The quote as a PDF, for the emailed link or its signed-in customer. Only once it is priced. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const s = await shopper();
  const byLink = token ? await quoteByToken(prisma, number, token) : null;
  const quote = byLink ?? (s.user ? await quoteForCustomer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!quote || !["SENT", "ACCEPTED", "DECLINED", "EXPIRED"].includes(quote.status)) return new Response("Not found", { status: 404 });
  const e = env();
  const bytes = await quotePdf(quote, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, token: byLink ? token : undefined });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Quote-${quote.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
