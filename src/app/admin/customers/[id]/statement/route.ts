import { DEFAULT_TIME_ZONE } from "@/config/app";
import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { customerStatement, statementPdf, statementPeriod } from "@/server/portal/accounts";
import { staffCan } from "@/server/staff/access";

/** A business customer's statement as they get it, for staff. ?from= and ?to= as yyyy-mm-dd; the last three months by default. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewCustomers")) return new Response("Not found", { status: 404 });
  const org = await prisma.organisation.findUnique({
    where: { id: (await params).id },
    select: {
      id: true,
      market: { select: { timeZone: true, supportEmail: true } },
    },
  });
  if (!org) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const period = statementPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, org.market.timeZone ?? DEFAULT_TIME_ZONE);
  // The user id is not used for a business: the statement covers the whole organisation.
  const st = await customerStatement(prisma, { userId: "", organisationId: org.id }, period.from, period.to);
  const e = env();
  return pdfResponse(
    await statementPdf(st, {
      appUrl: e.APP_URL,
      legalName: e.COMPANY_LEGAL_NAME,
      supportEmail: org.market.supportEmail,
    }),
    `Statement-${period.fromDay}-to-${period.toDay}.pdf`,
  );
}
