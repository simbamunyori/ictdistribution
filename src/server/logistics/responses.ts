/** Logistics papers as downloads: never cached, never run in the page. */

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), { headers: { ...HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename.replace(/["\r\n]/g, "")}"` } });
}

/** Proof of delivery, when there is one. */
export function podResponse(d: { podBytes: Uint8Array | null; podContentType: string | null; podFilename: string | null } | null) {
  if (!d?.podBytes || !d.podContentType) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(d.podBytes), { headers: { ...HEADERS, "Content-Type": d.podContentType, "Content-Disposition": `inline; filename="${(d.podFilename ?? "proof").replace(/["\r\n]/g, "")}"`, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox" } });
}
