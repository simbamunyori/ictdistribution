import { currentSession } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { documentResponse } from "@/server/procurement/download";
import { readPoDocument } from "@/server/procurement/supplier";

/** A file sent for a purchase order, for staff who can see purchase orders. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole) return new Response("Not found", { status: 404 });
  const { id, docId } = await params;
  try {
    const doc = await readPoDocument(prisma, docId, { actor: { userId: session.userId, name: session.user.name, staffRole: session.user.staffRole } });
    if (doc.purchaseOrderId !== id) return new Response("Not found", { status: 404 });
    return documentResponse(doc);
  } catch (e) {
    if (e instanceof DomainError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
