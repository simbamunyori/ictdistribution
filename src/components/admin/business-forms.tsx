"use client";

import { useActionState } from "react";
import {
  approveOrganisationAction,
  categoryMarkupAction,
  creditDecisionAction,
  creditTermsAction,
  customerPriceAction,
  rejectOrganisationAction,
  volumeBreakAction,
} from "@/app/admin/(console)/business-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

type Option = { value: string; label: string };
const initial = {} as ActionState;

function Submit({ pending, label, pendingLabel = "Saving", variant, name, value }: { pending: boolean; label: string; pendingLabel?: string; variant?: "primary" | "secondary" | "destructive"; name?: string; value?: string }) {
  return (
    <Button type="submit" variant={variant} disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FormErrors({ state }: { state: ActionState }) {
  return (
    <>
      {state.fieldErrors && !state.error ? <Alert>Check the highlighted fields.</Alert> : null}
      <Outcome state={state} />
    </>
  );
}

// ─── Checking businesses ─────────────────────────────────────────────

export function ApproveForm({ organisationId, level }: { organisationId: string; level: string }) {
  const [state, action, pending] = useActionState(approveOrganisationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organisationId" value={organisationId} />
      <Outcome state={state} />
      <div>
        <Submit pending={pending} label={`Approve for ${level} prices`} pendingLabel="Approving" />
      </div>
    </form>
  );
}

export function RejectForm({ organisationId, approved }: { organisationId: string; approved: boolean }) {
  const [state, action, pending] = useActionState(rejectOrganisationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate key={state.ok ? "done" : "open"}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <TextAreaField id="note" label={approved ? "Why trade prices are withdrawn" : "What they need to change"} rows={2} defaultValue={state.ok ? "" : (state.values?.note ?? "")} error={state.fieldErrors?.note} hint="The owners read this in an email and on their account." />
      <FormErrors state={state} />
      <div>
        <Submit pending={pending} label={approved ? "Withdraw approval" : "Send back"} pendingLabel="Sending" variant={approved ? "destructive" : "secondary"} />
      </div>
    </form>
  );
}

// ─── Agreed prices ───────────────────────────────────────────────────

export function CustomerPriceForm({ organisationId, currency, taxName }: { organisationId: string; currency: string; taxName: string }) {
  const [state, action, pending] = useActionState(customerPriceAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate key={state.ok ? `done-${state.message}` : "open"}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="product" label="Product" defaultValue={v.product ?? ""} error={err.product} hint="Its part number, or its address in the shop." />
        <TextField id="price" label={`Price each in ${currency}, including ${taxName}`} inputMode="decimal" defaultValue={v.price ?? ""} error={err.price} />
        <TextField id="validUntil" label="Until (optional)" type="date" defaultValue={v.validUntil ?? ""} error={err.validUntil} hint="Leave empty for no end date." />
        <TextField id="cp-note" name="note" label="Note for staff (optional)" defaultValue={v.note ?? ""} error={err.note} hint="Such as the quote or contract it comes from." />
      </div>
      <FormErrors state={state} />
      <div>
        <Submit pending={pending} label="Save agreed price" />
      </div>
    </form>
  );
}

// ─── Credit ──────────────────────────────────────────────────────────

export function CreditTermsForm({ organisationId, currency, values, maxDays }: { organisationId: string; currency: string; values: { limit: string; termsDays: string; onHold: boolean }; maxDays: number }) {
  const [state, action, pending] = useActionState(creditTermsAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="limit" label={`Credit limit in ${currency}`} inputMode="decimal" defaultValue={v.limit ?? values.limit} error={err.limit} hint="Leave empty to close the account." />
        <TextField id="termsDays" label="Days to pay" inputMode="numeric" defaultValue={v.termsDays ?? values.termsDays} error={err.termsDays} hint={`From 1 to ${maxDays}.`} />
      </div>
      <CheckboxField id="onHold" label="On hold" hint="Stops new orders on account. What is owed stays owed." defaultChecked={values.onHold} />
      <FormErrors state={state} />
      <div>
        <Submit pending={pending} label="Save credit terms" />
      </div>
    </form>
  );
}

export function CreditDecisionForm({ applicationId, organisationId, currency, requested, maxDays }: { applicationId: string; organisationId: string; currency: string; requested: { limit: string; termsDays: string }; maxDays: number }) {
  const [state, action, pending] = useActionState(creditDecisionAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const id = (k: string) => `${k}-${applicationId}`;
  if (state.ok) return <Outcome state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id={id("limit")} name="limit" label={`Limit in ${currency}`} inputMode="decimal" defaultValue={v.limit ?? requested.limit} error={err.limit} />
        <TextField id={id("termsDays")} name="termsDays" label="Days to pay" inputMode="numeric" defaultValue={v.termsDays ?? requested.termsDays} error={err.termsDays} hint={`From 1 to ${maxDays}.`} />
      </div>
      <TextAreaField id={id("note")} name="note" label="Note for the customer" rows={2} defaultValue={v.note ?? ""} error={err.note} hint="Needed when you decline. Optional when you approve." />
      <FormErrors state={state} />
      <div className="flex flex-wrap gap-3">
        <Submit pending={pending} label="Approve" pendingLabel="Saving" name="decision" value="approve" />
        <Submit pending={pending} label="Decline" pendingLabel="Saving" name="decision" value="decline" variant="secondary" />
      </div>
    </form>
  );
}

// ─── Price level rules ───────────────────────────────────────────────

export function CategoryMarkupForm({ type, categories }: { type: string; categories: Option[] }) {
  const [state, action, pending] = useActionState(categoryMarkupAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  const id = (k: string) => `${k}-${type}`;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate key={state.ok ? `done-${state.message}` : "open"}>
      <input type="hidden" name="type" value={type} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <SelectField id={id("categoryId")} name="categoryId" label="Category" options={[{ value: "", label: "Choose a category" }, ...categories]} defaultValue={v.categoryId ?? ""} error={err.categoryId} />
        <TextField id={id("markupPercent")} name="markupPercent" label="Markup, percent" inputMode="decimal" defaultValue={v.markupPercent ?? ""} error={err.markupPercent} />
      </div>
      <FormErrors state={state} />
      <div>
        <Submit pending={pending} label="Set markup" variant="secondary" />
      </div>
    </form>
  );
}

export function VolumeBreakForm({ type, categories }: { type: string; categories: Option[] }) {
  const [state, action, pending] = useActionState(volumeBreakAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  const id = (k: string) => `vb-${k}-${type}`;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate key={state.ok ? `done-${state.message}` : "open"}>
      <input type="hidden" name="type" value={type} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField id={id("minQuantity")} name="minQuantity" label="From quantity" inputMode="numeric" defaultValue={v.minQuantity ?? ""} error={err.minQuantity} />
        <TextField id={id("discountPercent")} name="discountPercent" label="Percent off" inputMode="decimal" defaultValue={v.discountPercent ?? ""} error={err.discountPercent} />
        <SelectField id={id("categoryId")} name="categoryId" label="For" options={[{ value: "", label: "Every product" }, ...categories]} defaultValue={v.categoryId ?? ""} error={err.categoryId} />
      </div>
      <FormErrors state={state} />
      <div>
        <Submit pending={pending} label="Add break" pendingLabel="Adding" variant="secondary" />
      </div>
    </form>
  );
}
