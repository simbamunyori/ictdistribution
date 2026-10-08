import { expect, test } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/** After-sales: serial numbers and warranty, a repair asked for from them, staff settling a return, and credit notes. */
test("a customer finds a serial number's warranty and asks for a repair from it", async ({ page, context, baseURL }) => {
  await records();
  await signIn(context, "customer", baseURL!);
  await page.goto("/account/warranty");
  const row = page.getByRole("row", { name: /DEMO-SN-0001/ });
  await expect(row).toContainText("In warranty");
  await page.getByLabel("Find a serial number, product or order").fill("demo sn 0002");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("row", { name: /DEMO-SN-0002/ })).toContainText("Return RMA-TEST2");
  await expect(page.getByRole("row", { name: /DEMO-SN-0001/ })).toHaveCount(0);

  await page.goto("/account/warranty");
  await page.getByRole("link", { name: "Ask for a repair of DEMO-SN-0003" }).click();
  await expect(page.getByRole("checkbox", { name: /DEMO-SN-0003/ })).toBeChecked();
  await expect(page.getByLabel("Why")).toHaveValue("FAULTY");
  await expect(page.getByLabel("What would you like")).toHaveValue("REPAIR");
  await page.getByLabel("What is wrong").fill("The fan is very loud.");
  await page.getByRole("button", { name: "Ask for the return" }).click();
  await expect(page.getByRole("heading", { name: /^Return RMA-\d+$/ })).toBeVisible();
  await expect(page.getByText("You asked for a repair.")).toBeVisible();
  await expect(page.getByText(/Serial DEMO-SN-0003/)).toBeVisible();
});

test("credit notes open from the emailed link and the account", async ({ page, context, baseURL, request }) => {
  await records();
  await signIn(context, "customer", baseURL!);
  await page.goto("/account/invoices");
  await expect(page.getByRole("link", { name: /CN-TEST1/ })).toBeVisible();
  const pdf = await page.request.get("/credit-notes/CN-TEST1");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await request.get("/credit-notes/CN-TEST1?t=browser-checks-credit-note")).status()).toBe(200);
  expect((await request.get("/credit-notes/CN-TEST1?t=wrong")).status()).toBe(404);
  await page.goto("/account/statement");
  await expect(page.getByRole("link", { name: "CN-TEST1" })).toBeVisible();
});

test("staff find a serial and see what a replacement needs", async ({ page, context, baseURL }) => {
  const r = await records();
  await signIn(context, "staff", baseURL!);
  await page.goto("/admin/warranty?q=demosn0002");
  await expect(page.getByRole("row", { name: /DEMO-SN-0002/ })).toContainText("RMA-TEST2");
  await page.goto(`/admin/returns/${r.aftersalesReturn}`);
  await expect(page.getByText("Asks for a replacement.")).toBeVisible();
  await expect(page.getByText("Demo Couriers, DC888")).toBeVisible();
  await page.locator("#replace-reference").fill("DC1");
  await page.getByRole("button", { name: "Send replacement" }).click();
  await expect(page.getByText("Enter the serial number of the unit replacing DEMO-SN-0002.")).toBeVisible();
});
