import type { MetadataRoute } from "next";
import { env } from "@/server/env";

/** Read per request: the address comes from the server, not the build. */
export const dynamic = "force-dynamic";

/** The public pages. The catalogue adds its products here in D2 and D3. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${env().APP_URL}/`, changeFrequency: "daily", priority: 1 }];
}
