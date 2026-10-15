"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

export interface PoFormLine {
  id: string;
  position: number;
  description: string;
  mpn: string;
  quantity: number;
  /** As given before, to change it. */
  confirmedQuantity: string;
  shipDate: string;
  note: string;
  serials: string;
}

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

function Outcome({ state }: { state: ActionState }) {
  return (
    <>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.fieldErrors && !state.error ? <Alert>Check the highlighted fields.</Alert> : null}
      {state.message ? (
        <div role="status">
          <Alert tone="positive">{state.message}</Alert>
        </div>
      ) : null}
    </>
  );
}

/** Confirming a purchase order: the supplier's reference, when it ships, and any line only partly supplied. */
export function PoConfirmForm({ action, hidden, lines, given, submitLabel }: { action: Action; hidden: Record<string, string>; lines: PoFormLine[]; given: { supplierReference: string; expectedShipDate: string; note: string }; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const value = (key: string, before: string) => (state.values ? (state.values[key] ?? "") : before);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Hidden values={hidden} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="supplierReference" label="Your order reference (optional)" defaultValue={value("supplierReference", given.supplierReference)} error={err.supplierReference} hint="Such as your sales order number." />
        <TextField id="expectedShipDate" label="When it ships" type="date" defaultValue={value("expectedShipDate", given.expectedShipDate)} error={err.expectedShipDate} />
      </div>
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
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField id={`qty-${l.id}`} label="How many you can supply" inputMode="numeric" defaultValue={value(`qty-${l.id}`, l.confirmedQuantity)} error={err[`qty-${l.id}`]} hint={`Leave empty for all ${l.quantity}.`} />
            <TextField id={`ship-${l.id}`} label="Ships on, if different (optional)" type="date" defaultValue={value(`ship-${l.id}`, l.shipDate)} error={err[`ship-${l.id}`]} />
            <TextField id={`note-${l.id}`} label="Note (optional)" defaultValue={value(`note-${l.id}`, l.note)} />
          </div>
        </fieldset>
      ))}
      <TextAreaField id="note" label="Anything else (optional)" rows={3} defaultValue={value("note", given.note)} />
      <Outcome state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Marking it shipped: the date, the waybill and the serial numbers of each line. */
export function PoShipForm({ action, hidden, lines, given }: { action: Action; hidden: Record<string, string>; lines: PoFormLine[]; given: { shippedOn: string; shippingReference: string } }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const value = (key: string, before: string) => (state.values ? (state.values[key] ?? "") : before);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Hidden values={hidden} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="shippedOn" label="Shipped on" type="date" defaultValue={value("shippedOn", given.shippedOn)} error={err.shippedOn} />
        <TextField id="shippingReference" label="Waybill or tracking number (optional)" defaultValue={value("shippingReference", given.shippingReference)} error={err.shippingReference} />
      </div>
      {lines.map((l) => (
        <div key={l.id}>
          <input type="hidden" name="line" value={l.id} />
          <TextAreaField id={`serials-${l.id}`} label={`Serial numbers for ${l.position}. ${l.description} (optional)`} rows={3} defaultValue={value(`serials-${l.id}`, l.serials)} error={err[`serials-${l.id}`]} hint={`One per line, up to ${l.confirmedQuantity || l.quantity}.`} />
        </div>
      ))}
      <Outcome state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Mark as shipped"}
        </Button>
      </div>
    </form>
  );
}

const KINDS = [
  { value: "INVOICE", label: "Invoice" },
  { value: "PACKING_LIST", label: "Packing list" },
  { value: "OTHER", label: "Something else" },
];

/** Sending an invoice, packing list or other paper for the purchase order. */
export function PoDocumentForm({ action, hidden }: { action: Action; hidden: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Hidden values={hidden} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="kind" label="What it is" options={KINDS} defaultValue={state.values?.kind ?? "INVOICE"} error={err.kind} />
        <FileField id="po-file" name="file" label="File" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,application/pdf,image/png,image/jpeg,text/csv" error={err.file} hint="PDF, PNG, JPEG, Excel or CSV, up to 10 MB." />
      </div>
      <Outcome state={state} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending" : "Send the file"}
        </Button>
      </div>
    </form>
  );
}
