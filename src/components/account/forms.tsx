"use client";

import { useActionState } from "react";
import { confirmCodeAction, createOrganisationAction, inviteAction, profileAction, sendConfirmCodeAction } from "@/app/(site)/account/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type Option = { value: string; label: string };

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, action, pending] = useActionState(profileAction, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.message ? <Alert tone="positive">{state.message}</Alert> : null}
      <TextField id="name" label="Name" autoComplete="name" defaultValue={state.values?.name ?? name} />
      <TextField id="phone" label="Phone (optional)" type="tel" autoComplete="tel" defaultValue={state.values?.phone ?? phone ?? ""} hint="With the country code, for delivery." />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function CreateOrganisationForm({ countries, defaultCountry, types }: { countries: Option[]; defaultCountry: string; types: Option[] }) {
  const [state, action, pending] = useActionState(createOrganisationAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <TextField id="organisation" label="Organisation name" autoComplete="organization" defaultValue={state.values?.organisation} error={err.organisation} />
      <SelectField id="organisationType" label="What kind of organisation?" options={types} defaultValue={state.values?.organisationType ?? "BUSINESS"} error={err.organisationType} />
      <SelectField id="country" label="Country" options={countries} defaultValue={state.values?.country ?? defaultCountry} error={err.country} />
      <TextField id="registrationNumber" label="Company registration number (optional)" defaultValue={state.values?.registrationNumber} />
      <TextField id="taxNumber" label="Tax or VAT number (optional)" defaultValue={state.values?.taxNumber} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Setting it up" : "Set up the organisation"}
        </Button>
      </div>
    </form>
  );
}

export function InviteForm({ roles }: { roles: Option[] }) {
  const [state, action, pending] = useActionState(inviteAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <TextField id="email" label="Email" type="email" autoComplete="off" className="md:flex-1" defaultValue={state.values?.email} error={err.email} />
        <SelectField id="role" label="Role" options={roles} defaultValue={state.values?.role ?? "BUYER"} error={err.role} className="md:w-48" />
        <div className="md:pt-7">
          <Button type="submit" disabled={pending} className="w-full md:w-auto">
            {pending ? "Sending" : "Send invitation"}
          </Button>
        </div>
      </div>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.message ? <Alert tone="positive">{state.message}</Alert> : null}
    </form>
  );
}

/** The recent check by emailed code. Staff pages pass their own actions. */
export function ConfirmByEmail({
  next,
  email,
  sendAction = sendConfirmCodeAction,
  confirmAction = confirmCodeAction,
}: {
  next: string;
  email: string;
  sendAction?: (state: ActionState) => Promise<ActionState>;
  confirmAction?: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [sent, send, sending] = useActionState(sendAction, {} as ActionState);
  const [state, action, pending] = useActionState(confirmAction, {} as ActionState);
  if (!sent.ok) {
    return (
      <form action={send}>
        {sent.error ? <Alert className="mb-3">{sent.error}</Alert> : null}
        <Button type="submit" variant="secondary" size="lg" disabled={sending} className="w-full">
          {sending ? "Sending" : `Email a code to ${email}`}
        </Button>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Alert tone="positive">{sent.message}</Alert>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <TextField id="code" label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Checking" : "Confirm"}
      </Button>
    </form>
  );
}
