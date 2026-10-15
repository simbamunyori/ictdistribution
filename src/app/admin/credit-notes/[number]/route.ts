import { currentSession } from "@/server/auth/next";
import { creditNoteByNumber, creditNotePdf } from "@/server/aftersales/credit-notes";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { pdfResponse } from "@/server/logistics/responses";
import { staffCan } from "@/server/staff/access";

/** A credit note as the customer gets it, for staff. */
export async function GET(_: Request, { params }: { params: Promise<{ number: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewOrders")) return new Response("Not found", { status: 404 });
  const c = await creditNoteByNumber(prisma, (await params).number);
  if (!c) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await creditNotePdf(c, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Credit-note-${c.number}.pdf`);
}
