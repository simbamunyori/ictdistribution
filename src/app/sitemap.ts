import type { MetadataRoute } from "next";
import { IN_SHOP } from "@/server/catalogue/shop";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

/** Read per request: the address comes from the server, not the build. */
export const dynamic = "force-dynamic";

/** The public pages: home, the product list, specials, the assistant, every visible category and every product in the shop. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = env().APP_URL;
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { active: true, OR: [{ parentId: null }, { parent: { active: true } }] }, select: { slug: true, updatedAt: true } }),
    prisma.product.findMany({ where: IN_SHOP, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 45_000 }),
  ]);
  return [
    { url: `${site}/`, changeFrequency: "daily", priority: 1 },
    { url: `${site}/products`, changeFrequency: "daily", priority: 0.8 },
    { url: `${site}/specials`, changeFrequency: "daily", priority: 0.7 },
    { url: `${site}/assistant`, changeFrequency: "monthly", priority: 0.4 },
    ...categories.map((c) => ({ url: `${site}/categories/${c.slug}`, lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${site}/products/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
