import { AuthError } from "@/server/auth/service";
import { DomainError } from "@/server/errors";
import { RateLimitedError } from "@/server/security/rate-limit";

/** What a form's server action returns to the page. */
export interface ActionState {
  ok?: boolean;
  /** A message to show after success, e.g. "Invitation sent". */
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * Runs the work and turns a mistake the person can fix into a message on
 * the form. Anything else is a bug and is thrown, so it reaches the error
 * page and the logs.
 */
export async function run(work: () => Promise<string | void>, values?: Record<string, string>): Promise<ActionState> {
  try {
    const message = await work();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof DomainError) {
      return { error: e.fieldErrors ? (e.message === "Check the highlighted fields." ? undefined : e.message) : e.field ? undefined : e.message, fieldErrors: e.fieldErrors ?? (e.field ? { [e.field]: e.message } : undefined), values };
    }
    if (e instanceof AuthError) return { error: e.message, values };
    if (e instanceof RateLimitedError) return { error: "Too many tries. Wait a few minutes and try again.", values };
    throw e;
  }
}
