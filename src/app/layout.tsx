import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";
import { themeAttribute } from "@/lib/theme";
import { env } from "@/server/env";
import { currentTheme } from "@/server/theme";
import "./globals.css";

// brand/DEVELOPMENT.md: Inter for text and display (its optical sizes give
// Inter Display at headline sizes), JetBrains Mono for prices and codes.
// Served from our own files, never a font CDN.
const inter = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2", style: "normal", weight: "100 900" },
    { path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-opsz-italic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-inter",
  display: "swap",
});
const mono = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", style: "normal", weight: "100 800" }],
  variable: "--font-jetbrains",
  display: "swap",
});

/** Read per request, so the image builds without settings and APP_URL comes from the server. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(env().APP_URL),
    title: { default: `${company.name}: laptops, phones, networking and more`, template: `%s · ${company.name}` },
    description: `${company.tagline} Laptops, phones, networking, servers and software for homes and businesses across Southern Africa.`,
    applicationName: company.name,
    icons: {
      icon: [
        { url: "/brand/app-icon/ictdistribution-favicon.svg", type: "image/svg+xml" },
        { url: "/brand/png/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/png/favicon-16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: "/brand/png/app-icon-180.png",
    },
    manifest: "/manifest.webmanifest",
  };
}

/** The browser bar matches the page: the chosen theme, or the device's. */
export async function generateViewport(): Promise<Viewport> {
  const theme = themeAttribute(await currentTheme());
  if (theme) return { themeColor: tokens[theme].bg };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: tokens.light.bg },
      { media: "(prefers-color-scheme: dark)", color: tokens.dark.bg },
    ],
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request makes every page render per request, which the
  // content security policy needs: Next.js stamps its scripts with the
  // nonce from src/proxy.ts.
  await headers();
  const theme = themeAttribute(await currentTheme());
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
