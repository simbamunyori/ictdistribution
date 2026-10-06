import type { MetadataRoute } from "next";
import { env } from "@/server/env";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/sign-in", "/sign-up", "/invite"] }], sitemap: `${env().APP_URL}/sitemap.xml` };
}
