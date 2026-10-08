import "server-only";
import type { Special, SpecialItem } from "@prisma/client";
import type { SpecialFormValues } from "@/components/admin/shop-forms";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { toPlainAmount } from "@/lib/money";
import { toLocalInput } from "@/lib/zoned";
import { categoryOptions } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { listCustomerTypes } from "@/server/pricing/customer-types";
import { CUSTOMER_TYPES } from "@/server/shop/specials";

/** The choices the special forms offer. */
export async function specialFormOptions() {
  const [categories, markets, types] = await Promise.all([categoryOptions(prisma), prisma.market.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), listCustomerTypes(prisma)]);
  return {
    categories,
    markets: markets.map((m) => ({ value: m.code, label: `${m.name} (${m.currency})`, currency: m.currency, taxName: m.taxName })),
    customerTypes: types.filter((t) => CUSTOMER_TYPES.includes(t.code)).map((t) => ({ value: t.code, label: t.name })),
  };
}

/** A new special starts now and runs a week, for individuals. */
export function blankSpecial(now = new Date()): SpecialFormValues {
  return {
    name: "",
    description: "",
    kind: "PRODUCT",
    items: [],
    categoryId: "",
    mode: "percent",
    percent: "10",
    price: "",
    marketCode: "",
    startsAt: toLocalInput(now, DEFAULT_TIME_ZONE),
    endsAt: toLocalInput(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), DEFAULT_TIME_ZONE),
    quantityLimit: "",
    perOrderLimit: "",
    customerTypes: ["INDIVIDUAL"],
    featured: true,
    active: true,
  };
}

export function specialValues(s: Special & { market: { currency: string } | null; items: (SpecialItem & { product: { mpn: string } })[] }): SpecialFormValues {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    kind: s.kind,
    items: s.items.map((i) => ({ reference: i.product.mpn, quantity: String(i.quantity) })),
    categoryId: s.categoryId ?? "",
    mode: s.priceMinor !== null ? "price" : "percent",
    percent: s.discountBps !== null ? String(s.discountBps / 100) : "",
    price: s.priceMinor !== null && s.market ? toPlainAmount({ amountMinor: s.priceMinor, currency: s.market.currency }) : "",
    marketCode: s.marketCode ?? "",
    startsAt: toLocalInput(s.startsAt, DEFAULT_TIME_ZONE),
    endsAt: toLocalInput(s.endsAt, DEFAULT_TIME_ZONE),
    quantityLimit: s.quantityLimit !== null ? String(s.quantityLimit) : "",
    perOrderLimit: s.perOrderLimit !== null ? String(s.perOrderLimit) : "",
    customerTypes: s.customerTypes,
    featured: s.featured,
    active: s.active,
  };
}
