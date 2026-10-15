import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The unscoped client. Use it only for work that is not inside one
 * organisation: sign-in, sign-up, the admin area (which writes an audit
 * event for everything it changes) and background jobs. A business
 * customer's pages go through `tenantDb`.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Models that carry an organisationId column. A test fails if a model
 * with that column is missing here (src/server/db.test.ts). AuditEvent is
 * left out on purpose: it is read through src/server/audit.ts.
 */
export const TENANT_MODELS = new Set<string>(["Membership", "Invitation", "OrganisationDocument", "CustomerPrice", "CreditApplication"]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function withOrg(data: unknown, organisationId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => withOrg(d, organisationId));
  if (data && typeof data === "object") {
    const given = (data as Record<string, unknown>).organisationId;
    if (given !== undefined && given !== organisationId) {
      throw new Error("Refusing to write a row into another organisation.");
    }
    return { ...(data as object), organisationId };
  }
  return data;
}

/** Adds the organisation filter and stamp to one query's arguments. */
export function scopeArgs(model: string, operation: string, args: Args | undefined, organisationId: string): Args | undefined {
  if (!TENANT_MODELS.has(model)) return args;
  const next: Args = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) {
    next.where = { ...(next.where ?? {}), organisationId };
  }
  if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
    next.data = withOrg(next.data, organisationId);
  }
  if (operation === "upsert") {
    next.create = withOrg(next.create, organisationId);
  }
  if ((operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn" || operation === "upsert") && next.data && typeof next.data === "object") {
    if ("organisationId" in (next.data as object)) throw new Error("A row cannot move between organisations.");
  }
  if (operation === "upsert" && next.update && typeof next.update === "object" && "organisationId" in (next.update as object)) {
    throw new Error("A row cannot move between organisations.");
  }
  return next;
}

/**
 * A client that can only see and write one organisation's rows.
 *
 * Nested reads (include/select of a relation) follow foreign keys, so
 * they stay inside the organisation only when the parent row does; don't
 * include relations that point at other organisations' rows (there are
 * none in this schema). Nested writes are not scoped: create child rows
 * with their own call.
 */
export function tenantDb(organisationId: string) {
  if (!organisationId) throw new Error("tenantDb needs an organisation id.");
  return prisma.$extends({
    name: "tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, organisationId) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
export { Prisma };
