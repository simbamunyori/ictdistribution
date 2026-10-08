import type { NextRequest } from "next/server";
import { startOAuth } from "@/server/auth/oauth-routes";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return startOAuth(req, (await params).provider, "STAFF");
}
