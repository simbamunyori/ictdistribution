import type { PurchaseOrderDocument } from "@prisma/client";

/** A supplier document as a download: never cached, never run in the page. */
export function documentResponse(doc: Pick<PurchaseOrderDocument, "bytes" | "contentType" | "filename">) {
  const inline = doc.contentType === "application/pdf" || doc.contentType.startsWith("image/");
  return new Response(Buffer.from(doc.bytes), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.filename.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox",
    },
  });
}
