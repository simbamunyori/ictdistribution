import { expect, test } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/** The customer portal: a business's invoices, statement and payments, buying again, saved lists and returns. */
test("a business sees its invoices, statement and payments, with their papers", async ({ page, context, baseURL, request }) => {
  await signIn(context, "customer", baseURL!);
  await page.goto("/account/invoices");
  const row = page.getByRole("row", { name: /INV-TEST1/ });
  await expect(row).toContainText("ICT-TEST-3");
  await expect(row).toContainText("Overdue");
  const pdf = await page.request.get("/invoices/INV-TEST1");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  // The emailed link opens it without signing in; anything else doesn't.
  expect((await request.get("/invoices/INV-TEST1?t=browser-checks-invoice")).status()).toBe(200);
  expect((await request.get("/invoices/INV-TEST1?t=wrong")).status()).toBe(404);
  expect((await request.get("/invoices/INV-TEST1")).status()).toBe(404);

  await page.goto("/account/statement");
  await expect(page.getByRole("link", { name: "INV-TEST1" })).toBeVisible();
  await expect(page.getByText(/EFT DEMO/)).toBeVisible();
  const statement = await page.request.get(await page.getByRole("link", { name: "Download as PDF" }).getAttribute("href").then((h) => h!));
  expect(statement.headers()["content-type"]).toBe("application/pdf");

  await page.goto("/account/payments");
  await expect(page.getByRole("link", { name: "Invoice INV-TEST1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "EFT DEMO" })).toBeVisible();

  await page.goto("/account/deliveries");
  await expect(page.getByText("DN-TEST3")).toBeVisible();
  await expect(page.getByText(/signed for by Reception/)).toBeVisible();
});

test("buying again and saved lists put products in the cart", async ({ page, context, baseURL }) => {
  const r = await records();
  await signIn(context, "customer", baseURL!);
  await page.goto(`/orders/${r.portalOrderNumber}`);
  await expect(page.getByText("Placed by Kabo Demo")).toBeVisible();
  await page.getByRole("button", { name: "Buy again" }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText("Added to your cart.")).toBeVisible();

  const name = `Restock ${Date.now().toString(36)}`;
  await page.getByLabel("List name").fill(name);
  await page.getByRole("button", { name: "Save as a list" }).click();
  await expect(page.getByText(`Saved as ${name}.`)).toBeVisible();
  await page.goto("/account/lists");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Put it all in the cart" }).click();
  await expect(page).toHaveURL(/\/cart\?added=1/);

  await page.goto(`/products/${r.productSlug}`);
  await page.getByText("Save to a list").click();
  await page.getByLabel("Save to").selectOption({ label: "Office kit (demo)" });
  await page.getByRole("button", { name: "Save to list" }).click();
  await expect(page.getByText("Saved to Office kit (demo).")).toBeVisible();
});

test("a customer asks for a return and staff answer it", async ({ page, context, baseURL, browser }) => {
  const r = await records();
  await signIn(context, "customer", baseURL!);
  await page.goto(`/account/returns/new?order=${r.portalOrderNumber}`);
  await page.getByRole("button", { name: "Ask for the return" }).click();
  await expect(page.getByText("Choose why.")).toBeVisible();
  await page.locator('input[name^="qty-"]:not([disabled])').first().fill("1");
  await page.getByLabel("Why").selectOption("NOT_NEEDED");
  await page.getByLabel("What is wrong").fill("We ordered one too many.");
  await page.getByRole("button", { name: "Ask for the return" }).click();
  const heading = page.getByRole("heading", { name: /^Return RMA-\d+$/ });
  await expect(heading).toBeVisible();
  await expect(page.getByText(/We have your request/)).toBeVisible();
  const number = (await heading.textContent())!.replace("Return ", "");

  const staff = await browser.newContext();
  await signIn(staff, "staff", baseURL!);
  const admin = await staff.newPage();
  await admin.goto("/admin/returns?status=REQUESTED");
  await admin.getByRole("link", { name: number }).click();
  await admin.getByRole("button", { name: "Decline" }).first().click();
  await expect(admin.getByText("Say why, for the customer.")).toBeVisible();
  await admin.getByLabel("Why, for the customer").first().fill("Opened items can't be returned for a change of mind.");
  await admin.getByRole("button", { name: "Decline" }).first().click();
  // The answer replaces the forms, with what the customer was told.
  await expect(admin.getByText("Told the customer")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await staff.close();

  await page.reload();
  await expect(page.getByText("Opened items can't be returned for a change of mind.")).toBeVisible();
});
