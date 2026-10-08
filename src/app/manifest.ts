import type { MetadataRoute } from "next";
import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: company.name,
    short_name: company.shortName,
    start_url: "/",
    display: "standalone",
    background_color: tokens.light.bg,
    theme_color: tokens.brand.forest,
    icons: [
      { src: "/brand/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
