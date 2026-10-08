import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { creditNoteByToken, creditNoteForViewer, creditNotePdf } from "@/server/aftersales/credit-notes";
import { pdfResponse } from "@/server/logistics/responses";
import { shopper } from "@/server/shop/viewer";

/** A credit note as a PDF, for the emailed link or anyone signed in who may see it. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const byLink = token ? await creditNoteByToken(prisma, number, token) : null;
  const s = byLink ? null : await shopper();
  const c = byLink ?? (s?.user ? await creditNoteForViewer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!c) return new Response("Not found", { status: 404 });
  const e = env();
  return pdfResponse(await creditNotePdf(c, { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME }), `Credit-note-${c.number}.pdf`);
}
