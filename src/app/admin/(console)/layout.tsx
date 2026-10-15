import type { Metadata } from "next";
import Link from "next/link";
import { staffSignOutAction } from "@/app/admin/(auth)/actions";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { Logo } from "@/components/ui/logo";
import { company } from "@/config/app";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { waitingChecks } from "@/server/accounts/verification";
import { deliveriesWaiting } from "@/server/logistics/deliveries";
import { shipmentsOnTheWay } from "@/server/logistics/shipments";
import { purchaseOrdersWaiting } from "@/server/procurement/purchase-orders";
import { quotesWaiting } from "@/server/quotes/staff";
import { ordersWaiting } from "@/server/shop/orders";
import { STAFF_ROLE_LABEL, staffCan } from "@/server/staff/access";
import { waitingImports } from "@/server/suppliers/price-lists";
import { currentTheme } from "@/server/theme";

export const metadata: Metadata = { title: { template: `%s · Admin · ${company.shortName}`, default: `Admin · ${company.shortName}` }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  const role = session.user.staffRole;
  const canSuppliers = staffCan({ staffRole: role }, "viewSuppliers");
  const canOrders = staffCan({ staffRole: role }, "viewOrders");
  const canCustomers = staffCan({ staffRole: role }, "viewCustomers");
  const canCredit = staffCan({ staffRole: role }, "manageCredit");
  const canQuotes = staffCan({ staffRole: role }, "viewQuotes");
  const canPurchaseOrders = staffCan({ staffRole: role }, "viewPurchaseOrders");
  const canLogistics = staffCan({ staffRole: role }, "viewLogistics");
  const [held, lists, waiting, checks, applications, quotes, pos, onTheWay, deliveries, theme] = await Promise.all([
    prisma.exchangeRate.count({ where: { heldBack: { not: null } } }),
    canSuppliers ? waitingImports(prisma) : 0,
    canOrders ? ordersWaiting(prisma) : null,
    canCustomers && staffCan({ staffRole: role }, "verifyCustomers") ? waitingChecks(prisma) : 0,
    canCredit ? prisma.creditApplication.count({ where: { status: "PENDING" } }) : 0,
    canQuotes ? quotesWaiting(prisma) : null,
    canPurchaseOrders ? purchaseOrdersWaiting(prisma) : null,
    canLogistics ? shipmentsOnTheWay(prisma) : 0,
    canLogistics ? deliveriesWaiting(prisma) : null,
    currentTheme(),
  ]);
  const items: AdminNavItem[] = [
    { href: "/admin", label: "Overview" },
    ...(canOrders ? [{ href: "/admin/orders", label: "Orders", badge: waiting ? waiting.payment + waiting.toSend || undefined : undefined }] : []),
    ...(canQuotes ? [{ href: "/admin/quotes", label: "Quotes", badge: quotes ? quotes.review + quotes.byHand || undefined : undefined }] : []),
    ...(canPurchaseOrders ? [{ href: "/admin/purchase-orders", label: "Purchase orders", badge: pos ? pos.approve + pos.byHand || undefined : undefined }] : []),
    ...(canLogistics
      ? [
          { href: "/admin/logistics", label: "Shipments", badge: onTheWay || undefined },
          { href: "/admin/deliveries", label: "Deliveries", badge: deliveries ? deliveries.packed + deliveries.onTheRoad || undefined : undefined },
          { href: "/admin/stock", label: "Stock" },
        ]
      : []),
    ...(canCustomers ? [{ href: "/admin/customers", label: "Customers", badge: checks || undefined }] : []),
    ...(canCredit ? [{ href: "/admin/credit", label: "Credit", badge: applications || undefined }] : []),
    { href: "/admin/products", label: "Products" },
    { href: "/admin/categories", label: "Categories" },
    { href: "/admin/specials", label: "Specials" },
    { href: "/admin/shop", label: "Shop" },
    ...(canSuppliers
      ? [
          { href: "/admin/suppliers", label: "Suppliers", badge: lists || undefined },
          { href: "/admin/sourcing", label: "Supplier choice" },
        ]
      : []),
    { href: "/admin/customer-types", label: "Price levels" },
    { href: "/admin/markets", label: "Markets" },
    { href: "/admin/exchange-rates", label: "Exchange rates", badge: held || undefined },
    { href: "/admin/staff", label: "Staff" },
    ...(staffCan({ staffRole: role }, "viewAudit") ? [{ href: "/admin/audit", label: "Audit log" }] : []),
    { href: "/admin/account", label: "Your account" },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-page">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 lg:px-6">
          <Link href="/admin" aria-label={`${company.name} admin`} className="flex items-center gap-3 rounded-md">
            <Logo />
            <span className="hidden rounded-sm bg-forest px-2 py-0.5 text-caption font-bold text-white sm:inline">Staff</span>
          </Link>
          <div className="flex items-center gap-3">
            <p className="hidden text-right text-callout leading-tight md:block">
              <span className="block font-semibold text-ink">{session.user.name}</span>
              <span className="text-ink-muted">{STAFF_ROLE_LABEL[role]}</span>
            </p>
            <form action={staffSignOutAction}>
              <button type="submit" className="rounded-md px-3 py-2 font-semibold text-ink-muted hover:bg-surface hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:px-6 lg:py-10">
        <div className="flex min-w-0 flex-col gap-6">
          <AdminNav items={items} />
          <ThemeSwitch current={theme} className="hidden lg:inline-flex" />
        </div>
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
