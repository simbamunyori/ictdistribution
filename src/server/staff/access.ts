import type { StaffRole } from "@prisma/client";
import { DomainError } from "@/server/errors";

/**
 * What each staff role may do in the admin area. Checked on the server
 * before every staff action. Later milestones add their permissions here,
 * so the whole matrix stays in one place and on the Staff page.
 */

export interface StaffActor {
  userId: string;
  name: string;
  staffRole: StaffRole;
}

export const STAFF_PERMISSIONS = {
  viewCustomers: "See customer accounts and their history",
  manageCustomers: "Change a business customer's type",
  managePriceLevels: "Change the price level of each customer type",
  manageMarkets: "Add and change markets and currencies",
  manageRates: "Accept held-back exchange rates and fetch new ones",
  manageCatalogue: "Add and change categories, products, images and datasheets",
  viewSuppliers: "See suppliers, their costs and price lists",
  manageSuppliers: "Add and change suppliers, their costs and how supplier choice works",
  importPriceLists: "Import supplier price lists and apply them",
  manageShop: "Change the shop's home page, featured products, specials, delivery and bank details",
  viewOrders: "See shop orders and their customers",
  recordPayments: "Record payments received for orders",
  fulfilOrders: "Mark orders as sent or ready to collect",
  cancelOrders: "Cancel orders",
  manageStaff: "Invite staff, change their role and deactivate them",
  viewAudit: "Read the full audit log",
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSIONS;

const ALLOWED: Record<StaffPermission, StaffRole[]> = {
  viewCustomers: ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE", "SUPPORT"],
  manageCustomers: ["ADMIN", "SALES"],
  managePriceLevels: ["ADMIN"],
  manageMarkets: ["ADMIN"],
  manageRates: ["ADMIN", "FINANCE"],
  manageCatalogue: ["ADMIN", "PROCUREMENT"],
  viewSuppliers: ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE"],
  manageSuppliers: ["ADMIN", "PROCUREMENT"],
  importPriceLists: ["ADMIN", "PROCUREMENT"],
  manageShop: ["ADMIN", "SALES"],
  viewOrders: ["ADMIN", "SALES", "LOGISTICS", "FINANCE", "SUPPORT"],
  recordPayments: ["ADMIN", "FINANCE"],
  fulfilOrders: ["ADMIN", "SALES", "LOGISTICS"],
  cancelOrders: ["ADMIN", "SALES", "FINANCE"],
  manageStaff: ["ADMIN"],
  viewAudit: ["ADMIN", "FINANCE"],
};

export function staffCan(actor: Pick<StaffActor, "staffRole">, permission: StaffPermission): boolean {
  return ALLOWED[permission].includes(actor.staffRole);
}

export function assertStaffCan(actor: Pick<StaffActor, "staffRole">, permission: StaffPermission): void {
  if (!staffCan(actor, permission)) throw new DomainError("forbidden", "Your staff role doesn't allow that.");
}

export const STAFF_ROLES: StaffRole[] = ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE", "SUPPORT"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  ADMIN: "Admin",
  SALES: "Sales",
  PROCUREMENT: "Procurement",
  LOGISTICS: "Logistics",
  FINANCE: "Finance",
  SUPPORT: "Support",
};

export const STAFF_ROLE_DESCRIPTION: Record<StaffRole, string> = {
  ADMIN: "Everything, including settings, staff accounts and the audit log.",
  SALES: "Customers, quotes and orders.",
  PROCUREMENT: "Suppliers, supplier prices and purchase orders.",
  LOGISTICS: "Shipments, warehouses and deliveries.",
  FINANCE: "Exchange rates, credit, invoices, payments and the audit log.",
  SUPPORT: "Customer questions, returns and account help.",
};
