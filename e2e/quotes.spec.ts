import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/**
 * Quotes: a business asks for one with typed lines, it is priced from the
 * catalogue and sent straight away, and they accept it as an order on
 * account. A supplier answers a request for price on their page, and
 * confirms a purchase order on another. Axe checks each page with content in.
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

    await page.getByLabel("Street address or plot").fill("Plot 1, Gaborone West");
    await page.getByLabel("Town or city").fill("Gaborone");
    await page.getByLabel("Phone").fill("+267 71 234 567");
    await expect(page.getByLabel("On account")).toBeChecked();
    await page.getByRole("button", { name: /Accept and order for/ }).click();
    await expect(page).toHaveURL(/\/orders\/ICT-\d+\?t=.+&placed=1/);
    await expect(page.getByText(/Your order is placed/)).toBeVisible();
    await expect(page.getByText(/As quoted: prices per unit before VAT/)).toBeVisible();
    await noViolations(page);
    const proForma = await page.request.get(await page.getByRole("link", { name: /pro forma invoice/ }).getAttribute("href").then((h) => h!));
    expect(proForma.headers()["content-type"]).toBe("application/pdf");
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

test("a supplier confirms a purchase order from their link", async ({ page }) => {
  const r = await records();
  await page.goto(`/supplier/po/${r.poToken}`);
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await expect(page.getByText("Mpho Paid")).toHaveCount(0);
  await expect(page.getByText("ICT-TEST-2")).toHaveCount(0);
  const ships = new Date(Date.now() + 5 * 24 * 3_600_000).toISOString().slice(0, 10);
  await page.getByLabel("Your order reference (optional)").fill("SO-BROWSER");
  await page.getByLabel("When it ships").fill(ships);
  await page.getByRole("button", { name: /Confirm the order|Save the changes/ }).click();
  await expect(page.getByText(/We have your confirmation/).first()).toBeVisible();
  await noViolations(page);
  const pdf = await page.request.get(await page.getByRole("link", { name: "Download as PDF" }).getAttribute("href").then((h) => h!));
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});
