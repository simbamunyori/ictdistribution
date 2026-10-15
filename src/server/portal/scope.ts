import type { OrgRole } from "@prisma/client";
import { DomainError } from "@/server/errors";
import { can, type Permission } from "@/server/org/access";

/**
 * Whose records a signed-in customer sees in their account. Buying for an
 * organisation, they see the whole organisation's quotes, orders,
 * invoices, deliveries, returns and lists, by anyone on the team, as far
 * as their role allows. Buying for themselves, they see only their own.
 */

export interface PortalViewer {
  userId: string;
  name: string;
  email: string;
  organisationId: string | null;
  /** Their role in the organisation; null when buying for themselves. */
  role: OrgRole | null;
}

/** Records that belong to what the viewer is buying for. */
export function scopeWhere(v: Pick<PortalViewer, "userId" | "organisationId">): { organisationId: string } | { userId: string; organisationId: null } {
  return v.organisationId ? { organisationId: v.organisationId } : { userId: v.userId, organisationId: null };
}

/** Whether a record with these owners is the viewer's to see. */
export function inScope(v: Pick<PortalViewer, "userId" | "organisationId">, r: { userId: string | null; organisationId: string | null }): boolean {
  return v.organisationId ? r.organisationId === v.organisationId : r.organisationId === null && r.userId === v.userId;
}

/** A person buying for themselves may do everything with their own records. */
export function portalCan(v: Pick<PortalViewer, "role">, permission: Permission): boolean {
  return v.role === null || can({ role: v.role }, permission);
}

const REFUSED: Partial<Record<Permission, string>> = {
  buy: "Your role doesn't allow that. Ask an Owner or a Buyer.",
  accounts: "Your role doesn't allow seeing the statement. Ask an Owner or Finance.",
};

export function assertPortalCan(v: Pick<PortalViewer, "role">, permission: Permission): void {
  if (!portalCan(v, permission)) throw new DomainError("forbidden", REFUSED[permission] ?? "Your role doesn't allow that. Ask an Owner.");
}
