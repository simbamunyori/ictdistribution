/** A mistake the person can fix, or a rule they ran into. Shown on the form, never logged as a bug. */
export class DomainError extends Error {
  constructor(
    public readonly code: "forbidden" | "not-found" | "invalid" | "conflict" | "unavailable",
    message: string,
    /** The form field the message belongs to, when there is one. */
    public readonly field?: string,
    /** Every field at fault, when a form has several mistakes. */
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
