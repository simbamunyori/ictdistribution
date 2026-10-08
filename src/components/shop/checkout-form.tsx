"use client";

import { useActionState, useState } from "react";
import { placeOrderAction } from "@/app/(site)/shop-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/action-state";

export interface CheckoutChoices {
  delivery: { fee: string; note: string } | null;
  points: { id: string; name: string; address: string; hours: string }[];
  bankTransfer: boolean;
  /** Credit open to the buyer's business, already formatted. */
  account: { available: string; termsDays: number } | null;
  /** An approved business: asks for its own order reference. */
  business: boolean;
  /** Totals, already formatted, for each way of getting the order. */
  totals: { DELIVERY: string | null; COLLECTION: string };
  taxName: string;
  payDays: number;
}

export interface CheckoutPrefill {
  email: string;
  name: string;
  phone: string;
}

function Choice({ name, value, checked, onChange, label, hint, disabled }: { name: string; value: string; checked: boolean; onChange?: () => void; label: string; hint?: string; disabled?: boolean }) {
  const id = `${name}-${value}`;
  return (
    <div className={cn("flex items-start gap-3 rounded-md border border-line bg-raised p-4", checked && "border-brand", disabled && "opacity-60")}>
      <input id={id} type="radio" name={name} value={value} {...(onChange ? { checked, onChange } : { defaultChecked: checked })} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} className="mt-1 size-4 shrink-0 accent-[var(--t-primary)]" />
      <div>
        <label htmlFor={id} className="font-semibold text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-callout whitespace-pre-line text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Group({ legend, error, children }: { legend: string; error?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-headline font-bold">{legend}</legend>
      {children}
      {error ? <p className="text-callout text-negative">{error}</p> : null}
    </fieldset>
  );
}

export function CheckoutForm({ choices, prefill }: { choices: CheckoutChoices; prefill: CheckoutPrefill }) {
  const [state, action, pending] = useActionState(placeOrderAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [fulfilment, setFulfilment] = useState(v.fulfilment || (choices.delivery ? "DELIVERY" : "COLLECTION"));
  const [point, setPoint] = useState(v.collectionPointId || (choices.points.length === 1 ? choices.points[0].id : ""));
  const [payment, setPayment] = useState(v.paymentMethod || (choices.account ? "ACCOUNT" : "BANK_TRANSFER"));
  const total = fulfilment === "DELIVERY" ? choices.totals.DELIVERY : choices.totals.COLLECTION;
  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <Group legend="Your details">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="email" label="Email" type="email" autoComplete="email" defaultValue={v.email ?? prefill.email} error={err.email} hint="We send the order and payment details here." />
          <TextField id="name" label="Full name" autoComplete="name" defaultValue={v.name ?? prefill.name} error={err.name} />
          <TextField id="phone" label="Phone" type="tel" autoComplete="tel" defaultValue={v.phone ?? prefill.phone} error={err.phone} hint="For delivery or collection." />
        </div>
      </Group>

      <Group legend="Delivery or collection" error={err.fulfilment}>
        {choices.delivery ? <Choice name="fulfilment" value="DELIVERY" checked={fulfilment === "DELIVERY"} onChange={() => setFulfilment("DELIVERY")} label={`Deliver to me (${choices.delivery.fee})`} hint={choices.delivery.note || undefined} /> : null}
        {choices.points.length ? <Choice name="fulfilment" value="COLLECTION" checked={fulfilment === "COLLECTION"} onChange={() => setFulfilment("COLLECTION")} label="Collect from us (free)" /> : null}
      </Group>

      {fulfilment === "DELIVERY" ? (
        <Group legend="Delivery address">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="addressLine1" label="Street address or plot" autoComplete="address-line1" defaultValue={v.addressLine1 ?? ""} error={err.addressLine1} className="sm:col-span-2" />
            <TextField id="addressLine2" label="Building, unit or area (optional)" autoComplete="address-line2" defaultValue={v.addressLine2 ?? ""} error={err.addressLine2} className="sm:col-span-2" />
            <TextField id="city" label="Town or city" autoComplete="address-level2" defaultValue={v.city ?? ""} error={err.city} />
            <TextField id="postalCode" label="Postal code (optional)" autoComplete="postal-code" defaultValue={v.postalCode ?? ""} error={err.postalCode} />
          </div>
        </Group>
      ) : (
        <Group legend="Where to collect" error={err.collectionPointId}>
          {choices.points.map((p) => (
            <Choice key={p.id} name="collectionPointId" value={p.id} checked={point === p.id} onChange={() => setPoint(p.id)} label={p.name} hint={[p.address, p.hours].filter(Boolean).join("\n")} />
          ))}
        </Group>
      )}

      <Group legend="Payment" error={err.paymentMethod}>
        {choices.account ? (
          <Choice name="paymentMethod" value="ACCOUNT" checked={payment === "ACCOUNT"} onChange={() => setPayment("ACCOUNT")} label="On account" hint={`Pay within ${choices.account.termsDays} days of ordering. We send the order without waiting for payment. Available credit: ${choices.account.available}.`} />
        ) : null}
        {choices.bankTransfer ? (
          <Choice name="paymentMethod" value="BANK_TRANSFER" checked={payment === "BANK_TRANSFER"} onChange={() => setPayment("BANK_TRANSFER")} label="Bank transfer" hint={`We email our bank details and your reference. Pay within ${choices.payDays} ${choices.payDays === 1 ? "day" : "days"}; we send or prepare the order once the money arrives.`} />
        ) : null}
        <p className="text-callout text-ink-muted">Card payments are coming soon.</p>
      </Group>

      {choices.business ? <TextField id="customerReference" label="Your order reference (optional)" defaultValue={v.customerReference ?? ""} error={err.customerReference} hint="Such as your purchase order number. We show it on the order and in our emails." /> : null}

      <TextAreaField id="notes" label="Anything we should know (optional)" rows={3} defaultValue={v.notes ?? ""} error={err.notes} hint="Such as delivery times or directions." />

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.fieldErrors && !state.error ? <Alert>Check the highlighted fields.</Alert> : null}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5">
        <p className="flex justify-between gap-4 text-headline font-bold">
          <span>To pay</span>
          <span className="tabular-nums">{total ?? "Choose collection"}</span>
        </p>
        <p className="text-caption text-ink-muted">Including {choices.taxName}.</p>
        <Button type="submit" size="lg" disabled={pending || (!choices.bankTransfer && !choices.account) || !total} className="mt-2 w-full">
          {pending ? "Placing your order" : "Place order"}
        </Button>
      </div>
    </form>
  );
}
