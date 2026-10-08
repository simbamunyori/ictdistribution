import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/**
 * An approved business buys on account: sees its trade price and the
 * volume break, orders three with its own reference, and lands on the
 * order with what is owed and when. Axe checks each page with items in.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function noViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`)), `axe on ${page.url()}`).toEqual([]);
}

for (const width of [390, 1280]) {
  test(`a business buys on account at ${width} px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(context, "customer", baseURL!);
    const r = await records();

    await page.goto(`/products/${r.productSlug}`);
    await expect(page.getByRole("table", { name: "Buy more, pay less each" })).toBeVisible();
    await page.getByLabel("Quantity").fill("3");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page).toHaveURL(/\/cart\?added=1/);
    await expect(page.getByText(/Buying 3 takes 3% off/)).toBeVisible();
    await noViolations(page);

    await page.getByRole("link", { name: "Check out" }).click();
    await expect(page.getByLabel("On account")).toBeChecked();
    await expect(page.getByText(/Available credit/)).toBeVisible();
    await noViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll").toBe(true);

    await page.getByLabel("Phone").fill("+267 71 234 567");
    await page.getByLabel(/^Deliver to me/).check();
    await page.getByLabel("Street address or plot").fill("Plot 1, Kgale Hill");
    await page.getByLabel("Town or city").fill("Gaborone");
    await page.getByLabel("Your order reference (optional)").fill(`PO-${width}`);
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/ICT-\d+/);
    await expect(page.getByText(/Your order is placed/)).toBeVisible();
    await expect(page.getByText(`Your reference: PO-${width}`)).toBeVisible();
    await expect(page.getByText(/we send it before it is paid/)).toBeVisible();
    await noViolations(page);

    // Their credit page lists it to pay.
    await page.goto("/account/credit");
    await expect(page.getByRole("cell", { name: `PO-${width}` }).first()).toBeVisible();
  });
}
