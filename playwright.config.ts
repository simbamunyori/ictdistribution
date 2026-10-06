import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks: axe on every page, light and dark, phone and desktop
 * (e2e/a11y.spec.ts).
 * They run against a server that is already up with the demo seed
 * (BASE_URL, default http://localhost:3000); CI starts one with
 * `npm run build && npm start` first.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
