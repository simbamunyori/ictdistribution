import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { documentResponse } from "@/server/procurement/download";
import { readPoDocument } from "@/server/procurement/supplier";

/** A file sent for the purchase order, for the supplier's link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  try {
    return documentResponse(await readPoDocument(prisma, id, { token }));
  } catch (e) {
    if (e instanceof DomainError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
