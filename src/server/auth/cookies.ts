import type { UserKind } from "@prisma/client";

/** __Host- makes the browser insist on HTTPS, this exact host and path "/". */
export const SESSION_COOKIE: Record<UserKind, string> =
  process.env.NODE_ENV === "production" ? { CUSTOMER: "__Host-ictd_session", STAFF: "__Host-ictd_staff" } : { CUSTOMER: "ictd_session", STAFF: "ictd_staff" };
