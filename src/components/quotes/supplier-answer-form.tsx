"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

export interface AnswerFormLine {
  id: string;
  position: number;
  description: string;
  mpn: string | null;
  quantity: number;
  /** What was given before, to change it. */
  price: string;
  available: string;
  leadTimeDays: string;
  validUntil: string;
  notes: string;
  noOffer: boolean;
}

/**
 * Prices per line: on the supplier's response page, and for staff typing
 * in what a supplier told them. Blank lines are left as they are.
 */
export function SupplierAnswerForm({ action, hidden, lines, currency, note, submitLabel }: { action: (state: ActionState, form: FormData) => Promise<ActionState>; hidden: Record<string, string>; lines: AnswerFormLine[]; currency: string; note: string; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  const value = (key: string, given: string) => (state.values ? (v[key] ?? "") : given);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      {lines.map((l) => (
        <fieldset key={l.id} className="rounded-lg border border-line bg-raised p-4">
          <input type="hidden" name="line" value={l.id} />
          <legend className="px-1 font-bold">
            {l.position}. {l.description}
          </legend>
          <p className="mb-3 text-callout text-ink-muted">
            Quantity {l.quantity}
            {l.mpn ? `, part ${l.mpn}` : ""}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField id={`price-${l.id}`} name={`price-${l.id}`} label={`Price each (${currency})`} inputMode="decimal" defaultValue={value(`price-${l.id}`, l.price)} error={err[`price-${l.id}`]} hint="Before tax." />
            <TextField id={`available-${l.id}`} name={`available-${l.id}`} label="How many you have (optional)" inputMode="numeric" defaultValue={value(`available-${l.id}`, l.available)} error={err[`available-${l.id}`]} />
            <TextField id={`lead-${l.id}`} name={`lead-${l.id}`} label="Days to deliver (optional)" inputMode="numeric" defaultValue={value(`lead-${l.id}`, l.leadTimeDays)} error={err[`lead-${l.id}`]} />
            <TextField id={`valid-${l.id}`} name={`valid-${l.id}`} label="Price holds until (optional)" type="date" defaultValue={value(`valid-${l.id}`, l.validUntil)} error={err[`valid-${l.id}`]} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextField id={`notes-${l.id}`} name={`notes-${l.id}`} label="Notes (optional)" defaultValue={value(`notes-${l.id}`, l.notes)} hint="Such as an alternative part or the warranty." />
            <label className="flex min-h-11 items-center gap-2 font-semibold">
              <input type="checkbox" name={`none-${l.id}`} defaultChecked={state.values ? v[`none-${l.id}`] === "on" : l.noOffer} className="size-4 accent-[var(--t-primary)]" />
              Can&apos;t supply
            </label>
          </div>
        </fieldset>
      ))}
      <TextAreaField id="note" label="Anything else (optional)" rows={3} defaultValue={value("note", note)} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.fieldErrors && !state.error ? <Alert>Check the highlighted fields.</Alert> : null}
      {state.message ? (
        <div role="status">
          <Alert tone="positive">{state.message}</Alert>
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
