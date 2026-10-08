import { expect, test } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/** Finance: chasing an overdue invoice, the accounting export and the reports. */
test("finance chases an overdue invoice and exports to accounting", async ({ page, context, baseURL }) => {
  await records();
  await signIn(context, "staff", baseURL!);
  await page.goto("/admin/finance");
  const row = page.getByRole("row", { name: /INV-TEST1/ });
  await expect(row).toContainText("days late");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Send a reminder for INV-TEST1" }).click();
  await expect(page.getByText(/Reminder sent for INV-TEST1\.|A reminder for INV-TEST1 went in the last hour\./)).toBeVisible();

  await page.goto("/admin/finance/export");
  await expect(page.getByText(/invoices?, \d+ credit notes?/)).toBeVisible();
  const href = await page.getByRole("link", { name: /^Xero/ }).getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("INV-TEST1");
  expect((await page.request.get("/admin/finance/export-file?format=nothing")).status()).toBe(404);
});

test("reports show sales, margin, quotes, suppliers, stock and open orders", async ({ page, context, baseURL }) => {
  await records();
  await signIn(context, "staff", baseURL!);
  await page.goto("/admin/reports?from=2020-01-01");
  for (const heading of ["By market", "By category", "By customer type", "By supplier", "Top customers", "Margin per order", "Quotes", "Supplier performance", "Stock", "Open orders"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Last 30 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/);
});
