import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * A guest buys from the shop: adds a product, checks out with delivery
 * and bank transfer, and lands on the order page with how to pay. Axe
 * checks the cart and checkout with items in them on the way.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function noViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`)), `axe on ${page.url()}`).toEqual([]);
}

for (const width of [390, 1280]) {
  test(`a guest places an order at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/products?q=DEMO-P2425H");
    await page.getByRole("button", { name: /^Add .* to your cart$/ }).first().click();
    await expect(page).toHaveURL(/\/cart\?added=1/);
    await expect(page.getByText("Added to your cart.")).toBeVisible();
    await noViolations(page);

    await page.getByRole("link", { name: "Check out" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await noViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll").toBe(true);

    // Sent empty first: the form says what is missing.
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();

    await page.getByLabel("Email").fill("guest.e2e@example.co.bw");
    await page.getByLabel("Full name").fill("Thato Guest");
    await page.getByLabel("Phone").fill("+267 71 234 567");
    await page.getByLabel(/^Deliver to me/).check();
    await page.getByLabel("Street address or plot").fill("Plot 5, Main Mall");
    await page.getByLabel("Town or city").fill("Gaborone");
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/ICT-\d+\?t=.+&placed=1/);
    await expect(page.getByText(/Your order is placed/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "How to pay" })).toBeVisible();
    await noViolations(page);
  });
}
