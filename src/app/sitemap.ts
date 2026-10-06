import type { MetadataRoute } from "next";
import { env } from "@/server/env";

/** The public pages. The catalogue adds its products here in D2 and D3. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${env().APP_URL}/`, changeFrequency: "daily", priority: 1 }];
}
