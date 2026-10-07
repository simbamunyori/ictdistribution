import type { MetadataRoute } from "next";
import { env } from "@/server/env";

/** Read per request: the address comes from the server, not the build. */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/sign-in", "/sign-up", "/invite", "/quotes", "/orders", "/supplier"] }], sitemap: `${env().APP_URL}/sitemap.xml` };
}
