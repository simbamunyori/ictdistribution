import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { customerStatement, statementPdf, statementPeriod } from "@/server/portal/accounts";
import { portalCan } from "@/server/portal/scope";
import { shopper } from "@/server/shop/viewer";

/** The statement for a period as a PDF, for whoever may see it. */
export async function GET(request: Request) {
  const s = await shopper();
  if (!s.user) return new Response("Not found", { status: 404 });
  const v = { userId: s.user.id, organisationId: s.organisation?.id ?? null, role: s.organisation?.role ?? null };
  if (!portalCan(v, "accounts")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const period = statementPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, s.market.timeZone);
  const st = await customerStatement(prisma, v, period.from, period.to);
  const e = env();
  return pdfResponse(await statementPdf(st, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, supportEmail: s.market.supportEmail }), `Statement-${period.fromDay}-to-${period.toDay}.pdf`);
}
