import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/** The site assistant (answering by rules, as there is no API key here), passing to Sales, and product pages for search engines. */
test("a visitor asks the assistant, sees products and passes the conversation to Sales", async ({ page, context, baseURL }) => {
  const name = `Visitor ${Date.now()}`;
  await page.goto("/assistant");
  await page.getByLabel("What are you looking for?").fill("laptop for office work under P90,000");
  await page.keyboard.press("Enter");
  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation.getByText(/products? that match|is what matches/)).toBeVisible();
  await expect(conversation.getByRole("link").first()).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveValue("");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.getByText("Rather talk to a person?").click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill("visitor@example.co.bw");
  await page.getByRole("button", { name: "Pass this to Sales" }).click();
  await expect(page.getByText(/Passed to our Sales team/)).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveCount(0);

  await signIn(context, "staff", baseURL!);
  await page.goto("/admin/assistant");
  await page.getByRole("link", { name }).click();
  await expect(page.getByText("laptop for office work under P90,000")).toBeVisible();
  await page.getByRole("button", { name: "Mark dealt with" }).click();
  await expect(page.getByText(/^Closed by /)).toBeVisible();
  await page.goto("/admin/assistant?show=CLOSED");
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("a search with no match offers close matches and the assistant", async ({ page }) => {
  await page.goto("/products?q=lenovo+thinkpda");
  await expect(page.getByRole("link", { name: "tell our assistant what you need" })).toHaveAttribute("href", "/assistant?q=lenovo%20thinkpda");
  await expect(page.getByRole("heading", { name: "Close matches" })).toBeVisible();
});

test("product pages describe the product for search engines", async ({ page }) => {
  const r = await records();
  await page.goto(`/products/${r.productSlug}`);
  const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
  expect(data.map((d) => d["@type"])).toEqual(expect.arrayContaining(["Product", "BreadcrumbList"]));
  const product = data.find((d) => d["@type"] === "Product");
  expect(product).toMatchObject({ name: expect.any(String), sku: expect.any(String) });
  expect(JSON.stringify(product)).not.toMatch(/supplier|cost/i);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain(`/products/${r.productSlug}`);
  expect(await page.locator('meta[name="description"]').getAttribute("content")).toBeTruthy();
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`/products/${r.productSlug}`);
  expect(await (await page.request.get("/robots.txt")).text()).toContain("Disallow: /cart");
});
