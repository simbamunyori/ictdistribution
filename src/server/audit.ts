import type { ActorKind, Prisma, PrismaClient } from "@prisma/client";
import type { StaffActor } from "@/server/staff/access";

/**
 * The audit log: one table for everything that changes, by customers,
 * staff and the system. Rows can never change (a database trigger refuses
 * UPDATE and DELETE). Write in the same transaction as the change.
 */

type AuditClient = { auditEvent: { create: (args: { data: Prisma.AuditEventUncheckedCreateInput }) => Promise<unknown> } };

export interface AuditInput {
  actorKind: ActorKind;
  actorUserId?: string | null;
  actorLabel: string;
  /** Dotted code, e.g. "member.invited". */
  action: string;
  /** One plain sentence, e.g. "Invited thabo@acme.co.bw as Buyer". */
  summary: string;
  /** The business customer it concerns, if any. */
  organisationId?: string | null;
  /** The person it concerns, if any (an individual customer or a staff member). */
  subjectUserId?: string | null;
  targetType?: string;
  targetId?: string;
  data?: Prisma.InputJsonValue;
  /** Shown in the customer's own account history. Staff changes to a customer are always shown. */
  visibleToCustomer?: boolean;
  ipAddress?: string | null;
}

export async function audit(tx: AuditClient, input: AuditInput) {
  const aboutCustomer = Boolean(input.organisationId);
  if (input.actorKind === "STAFF" && aboutCustomer && input.visibleToCustomer === false) {
    throw new Error("Staff changes to a customer account are always visible to the customer.");
  }
  await tx.auditEvent.create({
    data: {
      organisationId: input.organisationId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel,
      action: input.action,
      summary: input.summary,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      data: input.data,
      visibleToCustomer: input.visibleToCustomer ?? (input.actorKind === "STAFF" && aboutCustomer),
      ipAddress: input.ipAddress ?? null,
    },
  });
}

/** A staff member acting. */
export function staffAudit(staff: StaffActor, rest: Omit<AuditInput, "actorKind" | "actorUserId" | "actorLabel">): AuditInput {
  return { actorKind: "STAFF", actorUserId: staff.userId, actorLabel: staff.name, ...rest };
}

export const SYSTEM_ACTOR = { actorKind: "SYSTEM" as const, actorLabel: "System" };

export interface AuditFilter {
  action?: string;
  actorUserId?: string;
  organisationId?: string;
  before?: Date;
}

/** The newest events first, for the admin audit page. */
export function listAudit(db: Pick<PrismaClient, "auditEvent">, f: AuditFilter = {}, take = 100) {
  return db.auditEvent.findMany({
    where: {
      ...(f.action ? { action: { startsWith: f.action } } : {}),
      ...(f.actorUserId ? { actorUserId: f.actorUserId } : {}),
      ...(f.organisationId ? { organisationId: f.organisationId } : {}),
      ...(f.before ? { createdAt: { lt: f.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}
