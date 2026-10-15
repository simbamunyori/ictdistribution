import { expect, test } from "@playwright/test";
import { records } from "./support/records";
import { signIn } from "./support/signed-in";

/** Staff record a past shipment and see it in the estimates; the customer sees where their order is, with its papers. */
test("staff record a past shipment and it feeds the freight estimates", async ({ page, context, baseURL }) => {
  await signIn(context, "staff", baseURL!);
  await page.goto("/admin/logistics/shipments/new?source=HISTORY");
  await page.getByLabel("How it travelled").selectOption("SEA");
  await page.getByLabel("From country").fill("IN");
  await page.getByLabel("Costs paid in").fill("USD");
  await page.getByLabel("Gross weight (kg)").fill("800");
  await page.getByLabel("Volume (cubic metres, optional)").fill("2.5");
  await page.getByLabel("Freight", { exact: true }).fill("1600");
  await page.getByLabel("Clearing agent fees").fill("300");
  await page.getByLabel("Days in transit (optional)").fill("32");
  await page.getByRole("button", { name: "Record shipment" }).click();
  await expect(page.getByRole("heading", { name: /^Shipment SH-\d+$/ })).toBeVisible();
  // 2.5 cubic metres by sea is 2,500 kg chargeable, more than the 800 kg it weighed.
  await expect(page.getByText("2,500 kg")).toBeVisible();

  await page.goto("/admin/logistics/estimates");
  const row = page.getByRole("row", { name: /Sea from IN/ });
  await expect(row).toContainText("$0.64");
  await expect(row).toContainText("32");

  await page.goto("/admin/logistics/shipments/new?source=HISTORY");
  await page.getByRole("button", { name: "Record shipment" }).click();
  await expect(page.getByText("Enter the weight in kilograms, such as 12.5.")).toBeVisible();
});

test("the customer sees where their order is, and its delivery note", async ({ page, request }) => {
  const r = await records();
  await page.goto(`/orders/${r.procuredOrderNumber}?t=${r.procuredOrderToken}`);
  await expect(page.getByRole("heading", { name: "Where it is" })).toBeVisible();
  await expect(page.getByText("Shipped by the supplier").first()).toBeVisible();
  await expect(page.getByText("DN-TEST1")).toBeVisible();
  // Being packed isn't shown to the customer yet, and supplier details never are.
  await expect(page.getByText("DN-TEST2")).toHaveCount(0);
  await expect(page.getByText("Waybill DEMO1")).toHaveCount(0);
  const note = await request.get(`/orders/${r.procuredOrderNumber}/deliveries/DN-TEST1/note?t=${r.procuredOrderToken}`);
  expect(note.status()).toBe(200);
  expect(note.headers()["content-type"]).toBe("application/pdf");
  expect((await request.get(`/orders/${r.procuredOrderNumber}/deliveries/DN-TEST1/note?t=wrong`)).status()).toBe(404);
  expect((await request.get(`/orders/${r.procuredOrderNumber}/commercial-invoice?t=${r.procuredOrderToken}`)).status()).toBe(200);
});
