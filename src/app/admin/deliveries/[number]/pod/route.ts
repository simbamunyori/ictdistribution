import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { podResponse } from "@/server/logistics/responses";
import { staffCan } from "@/server/staff/access";

/** The signed delivery note or photo, as proof of delivery. */
export async function GET(_: Request, { params }: { params: Promise<{ number: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "viewLogistics")) return new Response("Not found", { status: 404 });
  const d = await prisma.delivery.findUnique({ where: { number: decodeURIComponent((await params).number) }, select: { podBytes: true, podContentType: true, podFilename: true } });
  return podResponse(d);
}
