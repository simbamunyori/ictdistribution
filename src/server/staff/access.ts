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
  verifyCustomers: "Check business documents and approve or refuse trade accounts",
  manageCustomerPrices: "Agree prices for one customer",
  viewDocuments: "Open the documents businesses send to be checked",
  manageCredit: "Decide credit applications and set credit limits and terms",
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
  viewQuotes: "See requests for quote and the quotes sent",
  manageQuotes: "Check, change, send and cancel quotes",
  enterSupplierPrices: "Ask suppliers for prices and enter the prices they give",
  manageQuoteRules: "Change the rules for sending quotes automatically",
  viewPurchaseOrders: "See purchase orders to suppliers and their papers",
  managePurchaseOrders: "Approve, send, change and cancel purchase orders",
  manageProcurementRules: "Change the rules for sending purchase orders automatically",
  viewLogistics: "See shipments, freight estimates, duty rules, stock and deliveries",
  manageShipments: "Record shipments and their costs, track them and set freight figures",
  manageLogisticsRules: "Change duty rules and how freight is estimated",
  manageStock: "Add warehouses, receive and count stock",
  manageDeliveries: "Prepare deliveries, dispatch them and record proof of delivery",
  manageReturns: "Approve or decline customers' returns, receive the items, repair or replace them and settle them",
  recordSerials: "Record the serial numbers of items sold, which start their warranty",
  issueCreditNotes: "Issue credit notes for returned items and record refunds paid",
  viewReports: "See sales, margin, quote, supplier and stock reports",
  manageFinance: "Chase overdue invoices, export to the accounting package and change finance settings",
  handleAssistantChats: "Read conversations visitors pass from the site assistant to Sales, and close them",
  manageAssistant: "Turn the site assistant on or off and choose where its handovers go",
  manageStaff: "Invite staff, change their role and deactivate them",
  viewAudit: "Read the full audit log",
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSIONS;

const ALLOWED: Record<StaffPermission, StaffRole[]> = {
  viewCustomers: ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE", "SUPPORT"],
  manageCustomers: ["ADMIN", "SALES"],
  verifyCustomers: ["ADMIN", "SALES", "FINANCE"],
  manageCustomerPrices: ["ADMIN", "SALES"],
  viewDocuments: ["ADMIN", "SALES", "FINANCE"],
  manageCredit: ["ADMIN", "FINANCE"],
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
  viewQuotes: ["ADMIN", "SALES", "PROCUREMENT", "FINANCE", "SUPPORT"],
  manageQuotes: ["ADMIN", "SALES"],
  enterSupplierPrices: ["ADMIN", "SALES", "PROCUREMENT"],
  manageQuoteRules: ["ADMIN"],
  viewPurchaseOrders: ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE"],
  managePurchaseOrders: ["ADMIN", "PROCUREMENT"],
  manageProcurementRules: ["ADMIN"],
  viewLogistics: ["ADMIN", "SALES", "PROCUREMENT", "LOGISTICS", "FINANCE"],
  manageShipments: ["ADMIN", "PROCUREMENT", "LOGISTICS"],
  manageLogisticsRules: ["ADMIN"],
  manageStock: ["ADMIN", "LOGISTICS"],
  manageDeliveries: ["ADMIN", "SALES", "LOGISTICS"],
  manageReturns: ["ADMIN", "SALES", "LOGISTICS", "SUPPORT"],
  recordSerials: ["ADMIN", "SALES", "LOGISTICS", "SUPPORT"],
  issueCreditNotes: ["ADMIN", "FINANCE"],
  viewReports: ["ADMIN", "SALES", "FINANCE"],
  manageFinance: ["ADMIN", "FINANCE"],
  handleAssistantChats: ["ADMIN", "SALES", "SUPPORT"],
  manageAssistant: ["ADMIN", "SALES"],
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
  FINANCE: "Exchange rates, credit, invoices, payments, reports, the accounting export and the audit log.",
  SUPPORT: "Customer questions, returns and account help.",
};
