/** Every page the accessibility checks visit. */
export type Audience = "public" | "customer" | "staff";

export interface PageSpec {
  name: string;
  audience: Audience;
  path: string;
}

export const PAGES: PageSpec[] = [
  { name: "home", audience: "public", path: "/" },
  { name: "not-found", audience: "public", path: "/no-such-page" },
  { name: "sign-in", audience: "public", path: "/sign-in" },
  { name: "invitation-ended", audience: "public", path: "/invite/no-such-invitation" },
  { name: "staff-sign-in", audience: "public", path: "/admin/sign-in" },
  { name: "staff-invitation-ended", audience: "public", path: "/admin/invite/no-such-invitation" },
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
  { name: "admin-exchange-rates", audience: "staff", path: "/admin/exchange-rates" },
  { name: "admin-staff", audience: "staff", path: "/admin/staff" },
  { name: "admin-audit", audience: "staff", path: "/admin/audit" },
  { name: "admin-account", audience: "staff", path: "/admin/account" },
  { name: "admin-confirm", audience: "staff", path: "/admin/confirm" },
];
