import type { BrowserContext } from "@playwright/test";
import type { Audience } from "./pages";
import { DEMO_CUSTOMER, DEMO_STAFF, testSession } from "./sessions";

const cache = new Map<Audience, Promise<{ name: string; value: string }>>();

/**
 * Signs a browser context in as the demo customer or staff Admin. Public
 * pages stay signed out. A production build (npm start) names its cookies
 * with the __Host- prefix, a development server without it, so both are
 * set; the server reads the one it expects.
 */
export async function signIn(context: BrowserContext, audience: Audience, base: string) {
  if (audience === "public") return;
  if (!cache.has(audience)) cache.set(audience, testSession(audience === "staff" ? DEMO_STAFF : DEMO_CUSTOMER));
  const { name, value } = await cache.get(audience)!;
  await context.addCookies([
    { name, value, url: base },
    { name: `__Host-${name}`, value, url: base.replace(/^http:/, "https:"), secure: true },
  ]);
}
