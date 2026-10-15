import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

/** A file a supplier sent with their reply, for staff who may see suppliers. Never cached, never run in the page. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewSuppliers")) return new Response("Not found", { status: 404 });
  const { id, fileId } = await params;
  const f = await prisma.supplierReplyFile.findFirst({ where: { id: fileId, request: { quoteId: id } }, select: { name: true, mediaType: true, bytes: true } });
  if (!f) return new Response("Not found", { status: 404 });
  const inline = f.mediaType === "application/pdf" || f.mediaType.startsWith("image/");
  return new Response(Buffer.from(f.bytes), {
    headers: {
      "Content-Type": f.mediaType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
