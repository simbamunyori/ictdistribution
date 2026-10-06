import type { NextRequest } from "next/server";
import { finishOAuth } from "@/server/auth/oauth-routes";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return finishOAuth(req, (await params).provider, "STAFF");
}
