import { currentSession } from "@/server/auth/next";
import { readMedia } from "@/server/catalogue/media";
import { prisma } from "@/server/db";

/**
 * Product images and datasheets. Files are never changed in place (a new
 * upload gets a new id), so the shop's copies are cached for a year.
 * Files of products not in the shop are for signed-in staff only.
 */
export async function serveMedia(id: string, thumb: boolean): Promise<Response> {
  let m = await readMedia(prisma, id, { thumb, staff: false });
  let staffOnly = false;
  if (!m) {
    const session = await currentSession("STAFF");
    if (session?.stage === "ACTIVE") {
      m = await readMedia(prisma, id, { thumb, staff: true });
      staffOnly = true;
    }
  }
  if (!m) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const headers: Record<string, string> = {
    "content-type": m.contentType,
    "content-length": String(m.body.length),
    "cache-control": staffOnly ? "private, no-store" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (m.kind === "DATASHEET") headers["content-disposition"] = `inline; filename="${m.filename.replace(/"/g, "")}"`;
  return new Response(new Uint8Array(m.body), { headers });
}
