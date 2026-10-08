import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";
import { themeAttribute } from "@/lib/theme";
import { env } from "@/server/env";
import { currentTheme } from "@/server/theme";
import "./globals.css";

// brand/BRAND.md: Plus Jakarta Sans, served from our own files (one variable font for every weight).
const jakarta = localFont({
  src: [
    { path: "../../brand/fonts/PlusJakartaSans-Variable.woff2", style: "normal", weight: "200 800" },
    { path: "../../brand/fonts/PlusJakartaSans-Variable-Italic.woff2", style: "italic", weight: "200 800" },
  ],
  variable: "--font-jakarta",
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
        { url: "/brand/icons/favicon.svg", type: "image/svg+xml" },
        { url: "/brand/icons/favicon.ico", sizes: "any" },
      ],
      apple: "/brand/icons/apple-touch-icon.png",
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
    <html lang="en" className={jakarta.variable} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
