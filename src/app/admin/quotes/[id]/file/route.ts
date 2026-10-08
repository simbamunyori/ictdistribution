import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

/** The file a customer sent with their request, for staff only. Never cached, never run in the page. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewQuotes")) return new Response("Not found", { status: 404 });
  const q = await prisma.quote.findUnique({ where: { id: (await params).id }, select: { file: true, fileName: true, fileType: true } });
  if (!q?.file || !q.fileName) return new Response("Not found", { status: 404 });
  const pdf = q.fileType === "application/pdf";
  return new Response(Buffer.from(q.file), {
    headers: {
      "Content-Type": q.fileType ?? "application/octet-stream",
      "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename="${q.fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
