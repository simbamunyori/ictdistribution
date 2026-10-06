import type { OrgRole } from "@prisma/client";
import { DomainError } from "@/server/errors";

/**
 * Who may do what in a business customer's account. Every server action
 * checks here before it acts; hiding a button is only a courtesy.
 */

/** The person acting, as a member of the organisation. */
export interface Actor {
  membershipId: string;
  userId: string;
  name: string;
  role: OrgRole;
}

export type Permission =
  /** See quotes, orders, invoices, deliveries and the account history. */
  | "view"
  /** Place orders and ask for quotes. */
  | "buy"
  /** Invoices, statements, payments and credit. */
  | "finance"
  /** Invite people and change what they can do. */
  | "manageTeam"
  /** Change the company details. */
  | "manageOrganisation";

const ALLOWED: Record<Permission, OrgRole[]> = {
  view: ["OWNER", "BUYER", "FINANCE", "VIEWER"],
  buy: ["OWNER", "BUYER"],
  finance: ["OWNER", "FINANCE"],
  manageTeam: ["OWNER"],
  manageOrganisation: ["OWNER"],
};

export function can(actor: Pick<Actor, "role">, permission: Permission): boolean {
  return ALLOWED[permission].includes(actor.role);
}

export function assertCan(actor: Pick<Actor, "role">, permission: Permission): void {
  if (!can(actor, permission)) throw new DomainError("forbidden", "Your role doesn't allow that. Ask an owner.");
}

export const ORG_ROLES: OrgRole[] = ["OWNER", "BUYER", "FINANCE", "VIEWER"];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  OWNER: "Owner",
  BUYER: "Buyer",
  FINANCE: "Finance",
  VIEWER: "Viewer",
};

export const ORG_ROLE_DESCRIPTION: Record<OrgRole, string> = {
  OWNER: "Everything, including the team and the company details.",
  BUYER: "Places orders and asks for quotes.",
  FINANCE: "Invoices, statements, payments and credit.",
  VIEWER: "Sees everything. Changes nothing.",
};
