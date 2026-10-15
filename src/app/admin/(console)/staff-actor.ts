import "server-only";
import { requestContext, requireStaff } from "@/server/auth/next";
import type { StaffActor } from "@/server/staff/access";

/** The signed-in staff member and their address, checked again for every admin action. Not an action itself. */
export async function staff(): Promise<{ actor: StaffActor; ip: string | null }> {
  const session = await requireStaff();
  const ctx = await requestContext();
  return { actor: { userId: session.userId, name: session.user.name, staffRole: session.user.staffRole }, ip: ctx.ipAddress ?? null };
}
