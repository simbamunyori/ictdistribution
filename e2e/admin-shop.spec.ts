import { expect, test } from "@playwright/test";
import { signIn } from "./support/signed-in";

/** Staff add a bundle special from the admin area, and it shows in the shop. */
test("staff add a bundle special and the shop shows it", async ({ page, context, baseURL }) => {
  await signIn(context, "staff", baseURL!);
  const name = `Laptop and memory ${Date.now().toString(36)}`;
  await page.goto("/admin/specials/new");
  await page.getByLabel("Name customers see").fill(name);
  await page.getByLabel("On", { exact: true }).selectOption("BUNDLE");
  await page.getByLabel("Product 1, part number or address").fill("DEMO-85B12EA");
  await page.getByLabel("Product 2, part number or address").fill("DEMO-KVR56S46BS8-16");
  await page.getByLabel("Percentage off").fill("12");
  await page.getByRole("button", { name: "Add special" }).click();
  await expect(page.getByText("Added. It shows in the shop from its start time.")).toBeVisible();

  await page.goto("/specials");
  await expect(page.getByText(name)).toBeVisible();
});
