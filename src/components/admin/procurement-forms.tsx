"use client";

import { useActionState } from "react";
import { cancelPoAction, updateProcurementRulesAction } from "@/app/admin/(console)/procurement-actions";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

const initial = {} as ActionState;

export function CancelPoForm({ poId, withSupplier }: { poId: string; withSupplier: boolean }) {
  const [state, action, pending] = useActionState(cancelPoAction, initial);
  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm(withSupplier ? "Cancel this purchase order? The supplier is emailed." : "Cancel this purchase order?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="poId" value={poId} />
      <TextField id="reason" label={withSupplier ? "Why, for the supplier" : "Why"} defaultValue={state.ok ? "" : (state.values?.reason ?? "")} error={state.fieldErrors?.reason} />
      <Outcome state={state} />
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Cancelling" : "Cancel purchase order"}
        </Button>
      </div>
    </form>
  );
}

export interface ProcurementRulesValues {
  autoSend: boolean;
  maxAutoValue: string;
  onlyPreferred: boolean;
  deliverTo: string;
  paymentTerms: string;
}

export function ProcurementRulesForm({ given, base, canEdit }: { given: ProcurementRulesValues; base: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateProcurementRulesAction, initial);
  const sent = state.values && !state.ok ? state.values : null;
  const v: ProcurementRulesValues = sent ? { autoSend: sent.autoSend === "on", maxAutoValue: sent.maxAutoValue ?? "", onlyPreferred: sent.onlyPreferred === "on", deliverTo: sent.deliverTo ?? "", paymentTerms: sent.paymentTerms ?? "" } : given;
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h2 className="text-headline font-bold">Sending by itself</h2>
          <CheckboxField id="autoSend" label="Send purchase orders to suppliers automatically when they meet every rule below" defaultChecked={v.autoSend} hint="Anything else waits for Procurement to approve it." />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="maxAutoValue" label={`Most one can be worth (${base})`} inputMode="decimal" defaultValue={v.maxAutoValue} error={err.maxAutoValue} />
          </div>
          <CheckboxField id="onlyPreferred" label="Only to preferred suppliers" defaultChecked={v.onlyPreferred} hint="Mark a supplier preferred on its page." />
          <p className="text-callout text-ink-muted">A purchase order to a supplier who is switched off, has no email or WhatsApp number, or whose currency has no exchange rate always waits.</p>
        </section>
        <section className="flex flex-col gap-4">
          <h2 className="text-headline font-bold">On every purchase order</h2>
          <TextAreaField id="deliverTo" label="Deliver to" rows={3} defaultValue={v.deliverTo} error={err.deliverTo} hint="Our receiving address, with a contact name and phone number." />
          <TextField id="paymentTerms" label="Payment terms" defaultValue={v.paymentTerms} error={err.paymentTerms} hint="Such as 30 days from invoice." />
        </section>
      </fieldset>
      <Outcome state={state} />
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save rules"}
          </Button>
        </div>
      ) : (
        <p className="text-callout text-ink-muted">Only an Admin can change these rules.</p>
      )}
    </form>
  );
}
