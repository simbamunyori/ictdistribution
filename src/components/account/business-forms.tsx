"use client";

import { useActionState } from "react";
import { addDocumentAction, applyForCreditAction, businessDetailsAction, submitForCheckAction } from "@/app/(site)/account/business-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type Option = { value: string; label: string };

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.fieldErrors) return <Alert>Check the highlighted fields.</Alert>;
  if (state.message) return <div role="status"><Alert tone="positive">{state.message}</Alert></div>;
  return null;
}

export function BusinessDetailsForm({ details, locked }: { details: { name: string; registrationNumber: string; taxNumber: string; address: string; directors: string }; locked: boolean }) {
  const [state, action, pending] = useActionState(businessDetailsAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = { ...details, ...state.values };
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <TextField id="name" label="Registered name" autoComplete="organization" defaultValue={v.name} error={err.name} className="sm:col-span-2" />
        <TextField id="registrationNumber" label="Company registration number" defaultValue={v.registrationNumber} error={err.registrationNumber} />
        <TextField id="taxNumber" label="Tax or VAT number" defaultValue={v.taxNumber} error={err.taxNumber} />
        <TextAreaField id="address" label="Registered address" rows={3} defaultValue={v.address} error={err.address} className="sm:col-span-2" />
        <TextAreaField id="directors" label="Directors" rows={3} defaultValue={v.directors} error={err.directors} hint="Each director's full name on its own line." className="sm:col-span-2" />
      </fieldset>
      <Result state={state} />
      {locked ? null : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save details"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function AddDocumentForm({ kinds }: { kinds: Option[] }) {
  const [state, action, pending] = useActionState(addDocumentAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="kind" label="What is it?" options={kinds} defaultValue={state.values?.kind ?? kinds[0]?.value} error={err.kind} />
        <FileField id="file" label="File" accept="application/pdf,image/jpeg,image/png,image/webp" error={err.file} hint="A PDF, or a clear photo. Up to 10 MB." />
      </div>
      <Result state={state} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding" : "Add document"}
        </Button>
      </div>
    </form>
  );
}

export function SubmitForCheckForm({ ready }: { ready: boolean }) {
  const [state, action, pending] = useActionState(submitForCheckAction, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <div>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Sending" : "Send for checking"}
        </Button>
      </div>
    </form>
  );
}

export function CreditApplicationForm({ currency, maxDays }: { currency: string; maxDays: number }) {
  const [state, action, pending] = useActionState(applyForCreditAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="limit" label={`Credit limit you need (${currency})`} inputMode="decimal" defaultValue={v.limit ?? ""} error={err.limit} />
        <TextField id="termsDays" label="Days to pay" inputMode="numeric" defaultValue={v.termsDays ?? "30"} error={err.termsDays} hint={`Up to ${maxDays} days.`} />
        <TextAreaField id="details" label="About your business's buying" rows={5} defaultValue={v.details ?? ""} error={err.details} hint="Your usual monthly spend and two trade references, with contact details." className="sm:col-span-2" />
      </div>
      <Result state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending" : "Apply for credit"}
        </Button>
      </div>
    </form>
  );
}
