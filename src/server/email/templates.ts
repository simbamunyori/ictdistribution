import type { EmailBody } from "./layout";

/**
 * Every email we send, by kind. A template gets the queued payload (with
 * any sealed secret already opened) and returns the subject and body, or
 * null when it no longer applies.
 */

export interface TemplateContext {
  appUrl: string;
}

export type Rendered = { subject: string; body: EmailBody } | null;
type Template = (payload: Record<string, unknown>, ctx: TemplateContext) => Rendered;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const TEMPLATES: Record<string, Template> = {
  "auth.code": (p) => ({
    subject: `${str(p.code)} is your sign-in code`,
    body: {
      heading: "Your sign-in code",
      paragraphs: ["Enter this code to sign in. It works once, for the next 10 minutes."],
      code: str(p.code),
      footnote: "If you didn't ask for it, you can ignore this email. Nobody can sign in without the code.",
    },
  }),
  "staff.code": (p) => ({
    subject: `${str(p.code)} is your staff sign-in code`,
    body: {
      heading: "Your staff sign-in code",
      paragraphs: ["Enter this code, then use your passkey. The code works once, for the next 10 minutes."],
      code: str(p.code),
      footnote: "If you didn't ask for it, tell an Admin. Nobody can sign in without your passkey as well.",
    },
  }),
  "org.invitation": (p, ctx) => ({
    subject: `${str(p.inviter)} invited you to buy for ${str(p.organisation)}`,
    body: {
      heading: `Join ${str(p.organisation)}`,
      paragraphs: [`${str(p.inviter)} invited you to ${str(p.organisation)}'s account as ${str(p.role)}.`, "The link works for 7 days."],
      button: { label: "Accept the invitation", url: `${ctx.appUrl}/invite/${str(p.token)}` },
      footnote: "If you weren't expecting this, you can ignore it.",
    },
  }),
  "staff.invitation": (p, ctx) => ({
    subject: "Set up your staff account",
    body: {
      heading: `Welcome, ${str(p.name)}`,
      paragraphs: [`You have a staff account as ${str(p.role)}. Set it up with a passkey on this device: your fingerprint, face or device PIN.`, "The link works once, for 3 days."],
      button: { label: "Set up my account", url: `${ctx.appUrl}/admin/invite/${str(p.token)}` },
    },
  }),
  "security.method-added": (p) => ({
    subject: "A new way to sign in was added",
    body: {
      heading: "A new way to sign in",
      paragraphs: [`${str(p.what)} was added to your account.`, "If this wasn't you, sign in and remove it, then tell us."],
    },
  }),
};
