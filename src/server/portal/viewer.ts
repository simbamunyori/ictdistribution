import "server-only";
import { redirect } from "next/navigation";
import { shopper } from "@/server/shop/viewer";
import type { PortalViewer } from "./scope";

/** The signed-in customer, as their account pages see them. Sends anyone else to sign in. */
export async function portalViewer(next = "/account"): Promise<PortalViewer> {
  const s = await shopper();
  if (!s.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return { userId: s.user.id, name: s.user.name, email: s.user.email, organisationId: s.organisation?.id ?? null, role: s.organisation?.role ?? null };
}
