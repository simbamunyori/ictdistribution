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
  "order.placed": (p, ctx) => {
    const bank = str(p.method) === "BANK_TRANSFER";
    const account = str(p.method) === "ACCOUNT";
    const collect = str(p.fulfilment) === "COLLECTION";
    return {
      subject: `Order ${str(p.number)} received`,
      body: {
        heading: `Thank you, ${str(p.name)}`,
        paragraphs: [
          `We have your order ${str(p.number)} for ${str(p.total)}${str(p.customerReference) ? `, your reference ${str(p.customerReference)}` : ""}.`,
          ...(bank ? [`Pay by bank transfer by ${str(p.payBy)}, with ${str(p.number)} as the reference. We start on your order when the money arrives, and cancel it if it hasn't arrived by then.`] : []),
          ...(account ? [`It is on your account, due by ${str(p.payBy)}. We start on it now. Pay by bank transfer with ${str(p.number)} as the reference.`] : []),
          collect ? `Collect it from ${str(p.collection).split("\n").join(", ")}.` : `We deliver to ${str(p.address)}.`,
        ],
        list: str(p.lines).split("\n").filter(Boolean),
        ...(bank || account ? { box: { title: "Pay into", text: `${str(p.bankDetails)}\nReference: ${str(p.number)}` } } : {}),
        button: { label: "See your order", url: `${ctx.appUrl}/orders/${encodeURIComponent(str(p.number))}?t=${encodeURIComponent(str(p.token))}` },
        footnote: "Keep this email: the button shows your order without signing in.",
      },
    };
  },
  "order.paid": (p) => ({
    subject: `Payment received for order ${str(p.number)}`,
    body: {
      heading: "Payment received",
      paragraphs: [`Thank you. Order ${str(p.number)} is paid in full.`, str(p.fulfilment) === "COLLECTION" ? "We'll email you when it's ready to collect." : "We'll email you when it's on its way."],
    },
  }),
  "order.settled": (p) => ({
    subject: `Order ${str(p.number)} is paid`,
    body: {
      heading: "Payment received",
      paragraphs: [`Thank you. Order ${str(p.number)} on your account is paid in full.`],
    },
  }),
  "organisation.approved": (p, ctx) => ({
    subject: `${str(p.organisation)} is approved for trade prices`,
    body: {
      heading: "Your business account is approved",
      paragraphs: [`We have checked ${str(p.organisation)}. You now see ${str(p.level)} prices across the shop, including products we sell only to businesses.`, "You can also apply for credit, to buy on account."],
      button: { label: "Go to the shop", url: `${ctx.appUrl}/products` },
    },
  }),
  "organisation.changes-needed": (p, ctx) => ({
    subject: `We need a change to ${str(p.organisation)}'s details`,
    body: {
      heading: "Please check your business details",
      paragraphs: [`We couldn't approve ${str(p.organisation)} yet.`, str(p.note), "Make the change and send it again. Until then you see retail prices."],
      button: { label: "Update your details", url: `${ctx.appUrl}/account/business` },
    },
  }),
  "credit.approved": (p, ctx) => ({
    subject: `Credit approved for ${str(p.organisation)}`,
    body: {
      heading: "Your credit account is open",
      paragraphs: [`${str(p.organisation)} can now buy on account up to ${str(p.limit)}, paying each order within ${str(p.terms)} days.`, ...(str(p.note) ? [str(p.note)] : [])],
      button: { label: "See your credit", url: `${ctx.appUrl}/account/credit` },
    },
  }),
  "credit.declined": (p) => ({
    subject: `Your credit application for ${str(p.organisation)}`,
    body: {
      heading: "We can't offer credit yet",
      paragraphs: [str(p.note), "You can still order and pay by bank transfer. Apply again when things change."],
    },
  }),
  "order.sent": (p) => ({
    subject: `Order ${str(p.number)} is on its way`,
    body: {
      heading: "Your order is on its way",
      paragraphs: [`Order ${str(p.number)} has left us for ${str(p.address)}.`, ...(str(p.note) ? [str(p.note)] : [])],
    },
  }),
  "order.ready": (p) => ({
    subject: `Order ${str(p.number)} is ready to collect`,
    body: {
      heading: "Ready to collect",
      paragraphs: [`Order ${str(p.number)} is ready. Bring this email and an ID.`, ...(str(p.note) ? [str(p.note)] : [])],
      box: { title: "Collect from", text: str(p.collection) },
    },
  }),
  "order.cancelled": (p) => ({
    subject: `Order ${str(p.number)} cancelled`,
    body: {
      heading: "Your order is cancelled",
      paragraphs: [`We cancelled order ${str(p.number)}: ${str(p.reason)}.`, str(p.refund) ? "We'll refund what you paid and email you when it's done." : "Nothing was paid, so nothing more is needed."],
    },
  }),
};
