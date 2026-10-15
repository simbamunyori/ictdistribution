import "server-only";
import { cookies } from "next/headers";
import { COMPARE_COOKIE, readCompare } from "@/lib/catalogue";

/** The products this visitor is comparing. */
export async function compareIds(): Promise<string[]> {
  return readCompare((await cookies()).get(COMPARE_COOKIE)?.value);
}
