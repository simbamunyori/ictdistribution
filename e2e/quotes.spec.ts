import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/**
 * Quotes: a business asks for one with typed lines, it is priced from the
 * catalogue and sent straight away, and they accept it. A supplier answers
 * a request for price on their page. Axe checks each page with content in.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function noViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`)), `axe on ${page.url()}`).toEqual([]);
}

for (const width of [390, 1280]) {
  test(`a business asks for a quote and accepts it at ${width} px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(context, "customer", baseURL!);

    await page.goto("/account/quotes");
    await page.getByRole("link", { name: "Ask for a quote" }).click();
    await expect(page).toHaveURL(/\/account\/quotes\/new/);
    await page.getByLabel("Reseller project").check();
    await page.getByLabel("What do you need?").fill("2 x DEMO-KVR56S46BS8-16");
    await page.getByLabel("Your reference (optional)").fill(`Project ${width}`);
    await noViolations(page);
    await page.getByRole("button", { name: "Ask for a quote" }).click();

    await expect(page).toHaveURL(/\/quotes\/Q-\d+\?requested=1/);
    await expect(page.getByText(/We have your request/)).toBeVisible();
    await expect(page.getByRole("cell", { name: /16 GB DDR5 5600 SO-DIMM/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download the PDF" })).toBeVisible();
    await noViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll").toBe(true);

    const pdf = await page.request.get(await page.getByRole("link", { name: "Download the PDF" }).getAttribute("href").then((h) => h!));
    expect(pdf.headers()["content-type"]).toBe("application/pdf");

    await page.getByRole("button", { name: "Accept the quote" }).click();
    await expect(page.getByText(/You accepted this quote/)).toBeVisible();
    await page.goto("/account/quotes");
    await expect(page.getByText(`Project ${width}`).first()).toBeVisible();
  });
}

test("a supplier sends prices from their link", async ({ page }) => {
  const r = await records();
  await page.goto(`/supplier/rfq/${r.rfqToken}`);
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await expect(page.getByText("Neo Buyer")).toHaveCount(0);
  await expect(page.getByText("Demo Clinic")).toHaveCount(0);
  await page.getByLabel(/Price each/).fill("1450.00");
  await page.getByLabel("Days to deliver (optional)").fill("4");
  await page.getByRole("button", { name: "Send my prices" }).click();
  await expect(page.getByText(/We have your prices/).first()).toBeVisible();
  await noViolations(page);
});
