/** Every page the accessibility checks visit. */
export type Audience = "public" | "customer" | "staff";

export interface PageSpec {
  name: string;
  audience: Audience;
  /** A fixed address, or one built from seeded records (e2e/support/records.ts). */
  path: string | ((r: Record<string, string>) => string);
}

export const PAGES: PageSpec[] = [
  { name: "home", audience: "public", path: "/" },
  { name: "not-found", audience: "public", path: "/no-such-page" },
  { name: "sign-in", audience: "public", path: "/sign-in" },
  { name: "invitation-ended", audience: "public", path: "/invite/no-such-invitation" },
  { name: "staff-sign-in", audience: "public", path: "/admin/sign-in" },
  { name: "staff-invitation-ended", audience: "public", path: "/admin/invite/no-such-invitation" },
  { name: "products", audience: "public", path: "/products" },
  { name: "products-search", audience: "public", path: "/products?q=kingston&sort=name" },
  { name: "category", audience: "public", path: "/categories/networking" },
  { name: "category-filtered", audience: "public", path: "/categories/laptops?f.memory_type=DDR5&b=lenovo" },
  { name: "product", audience: "public", path: (r) => `/products/${r.productSlug}` },
  { name: "compare-empty", audience: "public", path: "/compare" },
  { name: "account", audience: "customer", path: "/account" },
  { name: "account-team", audience: "customer", path: "/account/team" },
  { name: "account-sign-in-methods", audience: "customer", path: "/account/sign-in-methods" },
  { name: "account-confirm", audience: "customer", path: "/account/confirm" },
  { name: "admin-overview", audience: "staff", path: "/admin" },
  { name: "admin-customers", audience: "staff", path: "/admin/customers" },
  { name: "admin-price-levels", audience: "staff", path: "/admin/customer-types" },
  { name: "admin-markets", audience: "staff", path: "/admin/markets" },
  { name: "admin-market", audience: "staff", path: "/admin/markets/bw" },
  { name: "admin-market-new", audience: "staff", path: "/admin/markets/new" },
  { name: "admin-products", audience: "staff", path: "/admin/products" },
  { name: "admin-product-new", audience: "staff", path: "/admin/products/new" },
  { name: "admin-product", audience: "staff", path: (r) => `/admin/products/${r.product}` },
  { name: "admin-categories", audience: "staff", path: "/admin/categories" },
  { name: "admin-category", audience: "staff", path: (r) => `/admin/categories/${r.category}` },
  { name: "admin-suppliers", audience: "staff", path: "/admin/suppliers" },
  { name: "admin-supplier-new", audience: "staff", path: "/admin/suppliers/new" },
  { name: "admin-supplier", audience: "staff", path: (r) => `/admin/suppliers/${r.supplier}` },
  { name: "admin-price-list-columns", audience: "staff", path: (r) => `/admin/suppliers/${r.supplier}/imports/${r.columnsImport}` },
  { name: "admin-price-list-review", audience: "staff", path: (r) => `/admin/suppliers/${r.supplier}/imports/${r.readyImport}` },
  { name: "admin-sourcing", audience: "staff", path: "/admin/sourcing" },
  { name: "admin-exchange-rates", audience: "staff", path: "/admin/exchange-rates" },
  { name: "admin-staff", audience: "staff", path: "/admin/staff" },
  { name: "admin-audit", audience: "staff", path: "/admin/audit" },
  { name: "admin-account", audience: "staff", path: "/admin/account" },
  { name: "admin-confirm", audience: "staff", path: "/admin/confirm" },
];
