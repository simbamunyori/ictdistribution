import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PAGES } from "./support/pages";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/**
 * WCAG 2.2 AA on every page, in both themes and at phone and desktop
 * widths. Fails on any axe violation, listing the rule, the element and
 * the fix.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const scheme of ["light", "dark"] as const) {
  for (const width of [390, 1280]) {
    test.describe(`${scheme} theme at ${width} px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 900 } });

      for (const spec of PAGES) {
        test(`${spec.name} has no accessibility problems`, async ({ page, context, baseURL }) => {
          await signIn(context, spec.audience, baseURL!);
          const path = typeof spec.path === "string" ? spec.path : spec.path(await records());
          const response = await page.goto(path);
          if (spec.audience !== "public") expect(new URL(page.url()).pathname, "stayed signed in").not.toMatch(/\/sign-in(\/|$)/);
          if (spec.name !== "not-found") expect(response?.status(), "page loaded").toBeLessThan(400);
          await page.waitForLoadState("networkidle");
          // The page never scrolls sideways on a phone.
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll").toBe(true);
          const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          const report = violations.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(" ")}\n  ${n.failureSummary?.replace(/\n/g, "\n  ")}`));
          expect(report, `axe on ${path}`).toEqual([]);
        });
      }
    });
  }
}
