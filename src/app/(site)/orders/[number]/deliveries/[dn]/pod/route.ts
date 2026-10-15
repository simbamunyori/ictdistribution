import { prisma } from "@/server/db";
import { podResponse } from "@/server/logistics/responses";
import { viewableOrder } from "@/server/shop/viewer";

/** Proof of delivery, for the order's emailed link or its signed-in customer. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string; dn: string }> }) {
  const { number, dn } = await params;
  const seen = await viewableOrder(number, new URL(request.url).searchParams.get("t") ?? "");
  if (!seen) return new Response("Not found", { status: 404 });
  const d = await prisma.delivery.findFirst({ where: { number: dn, orderId: seen.order.id }, select: { podBytes: true, podContentType: true, podFilename: true } });
  return podResponse(d);
}
