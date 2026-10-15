import { currentSession, requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { readDocument } from "@/server/accounts/verification";

/** A customer's company document, for staff only. Never cached; every opening is audited. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole) return new Response("Not found", { status: 404 });
  const actor = { userId: session.userId, name: session.user.name, staffRole: session.user.staffRole };
  try {
    const doc = await readDocument(prisma, actor, (await params).id, (await requestContext()).ipAddress);
    return new Response(Buffer.from(doc.bytes), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new Response("Not found", { status: e.code === "forbidden" ? 403 : 404 });
    throw e;
  }
}
