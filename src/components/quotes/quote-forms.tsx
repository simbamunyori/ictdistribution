"use client";

import { useActionState, useState } from "react";
import { acceptQuoteAction, declineQuoteAction, requestQuoteAction } from "@/app/(site)/quote-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Choice, Group } from "@/components/shop/checkout-form";
import { CheckboxField, FileField, TextAreaField, TextField } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/action-state";

const initial = {} as ActionState;

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.fieldErrors) return <Alert>Check the highlighted fields.</Alert>;
  if (state.message)
    return (
      <div role="status">
        <Alert tone="positive">{state.message}</Alert>
      </div>
    );
  return null;
}

export interface TypeOption {
  value: string;
  label: string;
  hint: string;
}

/** Asking for a quote: what for, the lines or a file, and the tender's details when it is one. */
export function QuoteRequestForm({ types, marketName, canTender, initialText = "" }: { types: TypeOption[]; marketName: string; canTender: boolean; initialText?: string }) {
  const [state, action, pending] = useActionState(requestQuoteAction, initial);
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  const [type, setType] = useState(v.type || "STANDARD");
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-headline font-bold">What is it for?</legend>
        {types
          .filter((t) => canTender || t.value !== "TENDER")
          .map((t) => (
            <div key={t.value} className={cn("flex items-start gap-3 rounded-md border border-line bg-raised p-4", type === t.value && "border-brand")}>
              <input id={`type-${t.value}`} type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} aria-describedby={`type-${t.value}-hint`} className="size-6 shrink-0 accent-[var(--t-primary)]" />
              <div>
                <label htmlFor={`type-${t.value}`} className="font-semibold text-ink">
                  {t.label}
                </label>
                <p id={`type-${t.value}-hint`} className="text-callout text-ink-muted">
                  {t.hint}
                </p>
              </div>
            </div>
          ))}
        {err.type ? <p className="text-callout text-negative">{err.type}</p> : null}
      </fieldset>

      <TextAreaField
        id="text"
        label="What do you need?"
        rows={8}
        defaultValue={v.text ?? initialText}
        error={err.text}
        hint="One item per line with how many, like 5 x Dell P2425H monitor. Paste from an email or a spreadsheet if that is easier."
      />
      <FileField id="file" label="Or send a file (optional)" accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" error={err.file} hint="A bill of materials, a spreadsheet or the tender document. PDF, Excel (.xlsx) or CSV, up to 10 MB." />

      {type === "TENDER" ? (
        <fieldset className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 font-bold">The tender</legend>
          <TextField id="tenderReference" label="Tender reference" defaultValue={v.tenderReference ?? ""} error={err.tenderReference} />
          <TextField id="tenderDeadline" label="Closes" type="datetime-local" defaultValue={v.tenderDeadline ?? ""} error={err.tenderDeadline} hint={`${marketName} time.`} />
          <TextAreaField id="requiredDocuments" label="Documents it asks for (optional)" rows={3} defaultValue={v.requiredDocuments ?? ""} error={err.requiredDocuments} hint="One per line, such as datasheets or manufacturer authorisation." className="sm:col-span-2" />
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="customerReference" label="Your reference (optional)" defaultValue={v.customerReference ?? ""} error={err.customerReference} hint="Such as a project name or request number." />
        <TextField id="phone" label="Phone (optional)" type="tel" autoComplete="tel" defaultValue={v.phone ?? ""} error={err.phone} hint="In case we need to ask about a line." />
      </div>
      <CheckboxField id="urgent" label="It is urgent" defaultChecked={v.urgent === "on"} hint="We give our suppliers less time to answer." />
      <Result state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending" : "Ask for a quote"}
        </Button>
      </div>
    </form>
  );
}

export interface AcceptChoices {
  points: { id: string; name: string; address: string; hours: string }[];
  bankTransfer: boolean;
  /** Credit open to the business, when it is. */
  account: { termsDays: number } | null;
  payDays: number;
  phone: string;
  total: string;
}

/**
 * Accept a quote, saying how it reaches you and how you pay, or decline
 * it. `token` is the emailed link's, when the page was opened with it.
 */
export function AnswerQuoteForms({ number, token, choices }: { number: string; token: string; choices: AcceptChoices }) {
  const [accepted, accept, accepting] = useActionState(acceptQuoteAction, initial);
  const [declined, decline, declining] = useActionState(declineQuoteAction, initial);
  const [declineOpen, setDeclineOpen] = useState(false);
  const v = accepted.values ?? {};
  const err = accepted.fieldErrors ?? {};
  const [fulfilment, setFulfilment] = useState(v.fulfilment || "DELIVERY");
  const [point, setPoint] = useState(v.collectionPointId || (choices.points.length === 1 ? choices.points[0].id : ""));
  const [payment, setPayment] = useState(v.paymentMethod || (choices.account ? "ACCOUNT" : "BANK_TRANSFER"));
  if (declined.ok) return <Result state={declined} />;
  return (
    <div className="flex flex-col gap-6">
      <form action={accept} className="flex flex-col gap-6" noValidate>
        <input type="hidden" name="number" value={number} />
        <input type="hidden" name="t" value={token} />
        <Group legend="Delivery or collection" error={err.fulfilment}>
          <Choice name="fulfilment" value="DELIVERY" checked={fulfilment === "DELIVERY"} onChange={() => setFulfilment("DELIVERY")} label="Deliver to us" hint="As quoted, at no extra charge." />
          {choices.points.length ? <Choice name="fulfilment" value="COLLECTION" checked={fulfilment === "COLLECTION"} onChange={() => setFulfilment("COLLECTION")} label="We collect it" /> : null}
        </Group>
        {fulfilment === "DELIVERY" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="addressLine1" label="Street address or plot" autoComplete="address-line1" defaultValue={v.addressLine1 ?? ""} error={err.addressLine1} className="sm:col-span-2" />
            <TextField id="addressLine2" label="Building, unit or area (optional)" autoComplete="address-line2" defaultValue={v.addressLine2 ?? ""} error={err.addressLine2} className="sm:col-span-2" />
            <TextField id="city" label="Town or city" autoComplete="address-level2" defaultValue={v.city ?? ""} error={err.city} />
            <TextField id="postalCode" label="Postal code (optional)" autoComplete="postal-code" defaultValue={v.postalCode ?? ""} error={err.postalCode} />
          </div>
        ) : (
          <Group legend="Where to collect" error={err.collectionPointId}>
            {choices.points.map((p) => (
              <Choice key={p.id} name="collectionPointId" value={p.id} checked={point === p.id} onChange={() => setPoint(p.id)} label={p.name} hint={[p.address, p.hours].filter(Boolean).join("\n")} />
            ))}
          </Group>
        )}
        <TextField id="phone" label="Phone" type="tel" autoComplete="tel" defaultValue={v.phone ?? choices.phone} error={err.phone} hint="For delivery or collection." />
        <Group legend="Payment" error={err.paymentMethod}>
          {choices.account ? <Choice name="paymentMethod" value="ACCOUNT" checked={payment === "ACCOUNT"} onChange={() => setPayment("ACCOUNT")} label="On account" hint={`Pay within ${choices.account.termsDays} days. We order it straight away.`} /> : null}
          {choices.bankTransfer ? <Choice name="paymentMethod" value="BANK_TRANSFER" checked={payment === "BANK_TRANSFER"} onChange={() => setPayment("BANK_TRANSFER")} label="Bank transfer" hint={`Pay the pro forma invoice within ${choices.payDays} ${choices.payDays === 1 ? "day" : "days"}; we order it when the money arrives.`} /> : null}
          {!choices.account && !choices.bankTransfer ? <p className="text-callout">Reply to the quote email and we will arrange payment.</p> : null}
        </Group>
        <TextAreaField id="notes" label="Anything we should know (optional)" rows={3} defaultValue={v.notes ?? ""} error={err.notes} hint="Such as delivery times or directions." />
        <Result state={accepted} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={accepting || (!choices.account && !choices.bankTransfer)}>
            {accepting ? "Placing your order" : `Accept and order for ${choices.total}`}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setDeclineOpen((o) => !o)} aria-expanded={declineOpen} aria-controls="decline-form">
            Decline
          </Button>
        </div>
      </form>
      {declineOpen ? (
        <form id="decline-form" action={decline} className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <input type="hidden" name="number" value={number} />
          <input type="hidden" name="t" value={token} />
          <TextField id="reason" label="Why? (optional)" defaultValue={declined.values?.reason ?? ""} hint="It helps us price better next time." />
          <Result state={declined} />
          <div>
            <Button type="submit" variant="destructive" disabled={declining}>
              {declining ? "Declining" : "Decline the quote"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
