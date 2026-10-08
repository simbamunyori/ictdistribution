import { DEFAULT_TIME_ZONE } from "@/config/app";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/accounting-export";
import { currentSession, requestContext } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { exportFile } from "@/server/finance/export";
import { statementPeriod } from "@/server/portal/accounts";
import { staffCan } from "@/server/staff/access";

/** The accounting export as a CSV download, for Admin and Finance. */
export async function GET(request: Request) {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole || !staffCan({ staffRole: session.user.staffRole }, "manageFinance")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) return new Response("Not found", { status: 404 });
  const period = statementPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, DEFAULT_TIME_ZONE);
  const actor = {
    userId: session.userId,
    name: session.user.name,
    staffRole: session.user.staffRole,
  };
  const { csv, filename } = await exportFile(prisma, actor, format, period.from, period.to, period, (await requestContext()).ipAddress ?? null);
  // A byte order mark so spreadsheet programs read names with accents correctly.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
