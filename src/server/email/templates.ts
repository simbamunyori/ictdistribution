import { company } from "@/config/app";
import type { EmailBody } from "./layout";

/**
 * Every email we send, by kind. A template gets the queued payload (with
 * any sealed secret already opened) and returns the subject and body, or
 * null when it no longer applies.
 */

export interface TemplateContext {
  appUrl: string;
}

/** `replyTo` sends answers somewhere other than the sending address, such as the quotes mailbox. */
export type Rendered = { subject: string; body: EmailBody; replyTo?: string } | null;
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
        footnote: `${str(p.quote) ? `It is made from your quote ${str(p.quote)}. ` : ""}The pro forma invoice: ${ctx.appUrl}/orders/${encodeURIComponent(str(p.number))}/pro-forma?t=${encodeURIComponent(str(p.token))}. Keep this email: its links show your order without signing in.`,
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
  "quote.received": (p, ctx) => ({
    subject: `We have your request for quote ${str(p.number)}`,
    body: {
      heading: `Thank you, ${str(p.name)}`,
      paragraphs: [
        `We have your ${str(p.type).toLowerCase()} request${str(p.reference) ? `, ${str(p.reference)},` : ""} as quote ${str(p.number)}.`,
        "We are pricing it now and will email the quote as soon as it is ready. Lines we need to ask our suppliers about can take up to a working day.",
      ],
      button: { label: "See your quotes", url: `${ctx.appUrl}/account/quotes` },
      footnote: "Reply to this email if anything in the request needs to change.",
    },
  }),
  "quote.sent": (p, ctx) => {
    const link = `${ctx.appUrl}/quotes/${encodeURIComponent(str(p.number))}?t=${encodeURIComponent(str(p.token))}`;
    return {
      subject: `Your quote ${str(p.number)} is ready`,
      body: {
        heading: "Your quote is ready",
        paragraphs: [
          `Quote ${str(p.number)}${str(p.tender) ? ` for tender ${str(p.tender)}` : ""} comes to ${str(p.total)} including ${str(p.taxName)}, for ${str(p.lines)} ${str(p.lines) === "1" ? "line" : "lines"}.`,
          `It is valid until ${str(p.validUntil)}. Accept it online and we start on your order, or download it as a PDF for your records.`,
        ],
        button: { label: "See and accept the quote", url: link },
        footnote: `The PDF: ${ctx.appUrl}/quotes/${encodeURIComponent(str(p.number))}/pdf?t=${encodeURIComponent(str(p.token))}. Keep this email: its links open the quote without signing in.`,
      },
    };
  },
  "quote.cancelled": (p) => ({
    subject: `Quote ${str(p.number)} withdrawn`,
    body: {
      heading: "We have withdrawn your quote",
      paragraphs: [`We withdrew quote ${str(p.number)}: ${str(p.reason)}.`, "Reply to this email and we will help with anything you still need."],
    },
  }),
  "quote.answered": (p, ctx) => ({
    subject: `Quote ${str(p.number)} ${str(p.outcome)} by ${str(p.customer)}`,
    body: {
      heading: `Quote ${str(p.outcome)}`,
      paragraphs: [`${str(p.customer)} ${str(p.outcome)} quote ${str(p.number)} for ${str(p.total)}.`, ...(str(p.order) ? [`It is now order ${str(p.order)}. Its purchase orders are made once it is paid or on account.`] : []), ...(str(p.reason) ? [`Their reason: ${str(p.reason)}`] : [])],
      button: { label: "Open the quote", url: `${ctx.appUrl}/admin/quotes/${encodeURIComponent(str(p.quoteId))}` },
    },
  }),
  "quote.tender-reminder": (p, ctx) => ({
    subject: `Tender ${str(p.tender)} closes ${str(p.closes)}`,
    body: {
      heading: "A tender closes soon",
      paragraphs: [`Tender ${str(p.tender)} (quote ${str(p.number)}) closes ${str(p.closes)} Gaborone time, which is ${str(p.closesThere)}.`, "Its quote hasn't gone to the customer yet. Check it and send it with the documents the tender asks for."],
      ...(str(p.documents) ? { box: { title: "Documents it asks for", text: str(p.documents) } } : {}),
      button: { label: "Open the quote", url: `${ctx.appUrl}/admin/quotes/${encodeURIComponent(str(p.quoteId))}` },
    },
  }),
  "supplier.rfq": (p, ctx) => ({
    subject: `${str(p.urgent) ? "Urgent: r" : "R"}equest for price ${str(p.reference)}`,
    replyTo: str(p.replyTo) || undefined,
    body: {
      heading: `Request for price ${str(p.reference)}`,
      paragraphs: [
        `Hello ${str(p.supplier)}. Please send your best price for the items below by ${str(p.deadline)}, Gaborone time.`,
        `Give the price per unit in ${str(p.currency)}, the quantity you have, the lead time to us and how long the price holds. Answer line by line with the button, or reply to this email keeping ${str(p.reference)} in the subject.`,
      ],
      list: str(p.lines).split("\n").filter(Boolean),
      button: { label: "Give your prices", url: `${ctx.appUrl}/supplier/rfq/${encodeURIComponent(str(p.token))}` },
      footnote: "If you can't supply an item, say so on the page and we won't chase you for it.",
    },
  }),
  "supplier.po": (p, ctx) => ({
    subject: `Purchase order ${str(p.number)} from ${company.name}`,
    replyTo: str(p.replyTo) || undefined,
    body: {
      heading: `Purchase order ${str(p.number)}`,
      paragraphs: [`Hello ${str(p.supplier)}. Please supply the items below for ${str(p.total)}, before tax, and quote ${str(p.number)} on your invoice.`, "Use the button to confirm the order with your reference and ship date, then to tell us when it ships with the serial numbers, and to send your invoice and packing list."],
      list: str(p.lines).split("\n").filter(Boolean),
      ...(str(p.deliverTo) ? { box: { title: "Deliver to", text: str(p.deliverTo) } } : {}),
      button: { label: "Confirm the order", url: `${ctx.appUrl}/supplier/po/${encodeURIComponent(str(p.token))}` },
      footnote: `${str(p.paymentTerms) ? `Payment terms: ${str(p.paymentTerms)}. ` : ""}The purchase order as a PDF: ${ctx.appUrl}/supplier/po/${encodeURIComponent(str(p.token))}/pdf`,
    },
  }),
  "supplier.po-cancelled": (p) => ({
    subject: `Purchase order ${str(p.number)} cancelled`,
    replyTo: str(p.replyTo) || undefined,
    body: {
      heading: `Purchase order ${str(p.number)} is cancelled`,
      paragraphs: [`Hello ${str(p.supplier)}. Please don't supply purchase order ${str(p.number)}: ${str(p.reason)}.`, "If it has already left you, reply to this email and we will arrange it with you."],
    },
  }),
  "po.to-approve": (p, ctx) => ({
    subject: `Order ${str(p.order)} needs purchasing`,
    body: {
      heading: "Purchasing needs you",
      paragraphs: [
        ...(str(p.waiting) ? [`Purchase orders for order ${str(p.order)} need approving or sending on WhatsApp: ${str(p.waiting)}.`] : []),
        ...(str(p.unassigned) ? [`These lines have no supplier, so buy them by hand:`] : []),
      ],
      list: str(p.unassigned).split("\n").filter(Boolean),
      button: { label: "Open the order", url: `${ctx.appUrl}/admin/orders/${encodeURIComponent(str(p.orderId))}` },
    },
  }),
  "po.updated": (p, ctx) => ({
    subject: `${str(p.supplier)} updated purchase order ${str(p.number)}`,
    body: {
      heading: `Purchase order ${str(p.number)}`,
      paragraphs: [`${str(p.supplier)} ${str(p.what)}.`],
      button: { label: "Open the purchase order", url: `${ctx.appUrl}/admin/purchase-orders/${encodeURIComponent(str(p.poId))}` },
    },
  }),
};
