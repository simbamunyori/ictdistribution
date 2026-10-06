"use client";

import { useActionState, useState } from "react";
import { requestCodeAction, resendCodeAction, signUpAction, verifyCodeAction } from "@/app/(site)/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/** Step one of signing in by email. Staff pages pass their own action. */
export function EmailForm({ next, label = "Continue with email", defaultEmail, action: send = requestCodeAction }: { next?: string; label?: string; defaultEmail?: string; action?: FormAction }) {
  const [state, action, pending] = useActionState(send, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      <TextField id="email" label="Email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values?.email ?? defaultEmail} error={state.fieldErrors?.email} hint="We'll email you a six-digit code. No password needed." />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending your code" : label}
      </Button>
    </form>
  );
}

export function CodeForm({ verify = verifyCodeAction, resend: resendAction = resendCodeAction }: { verify?: FormAction; resend?: (state: ActionState) => Promise<ActionState> }) {
  const [state, action, pending] = useActionState(verify, {} as ActionState);
  const [resent, resend, resending] = useActionState(resendAction, {} as ActionState);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.error ? <Alert>{state.error}</Alert> : null}
        <TextField
          id="code"
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          required
          autoFocus
          className="[&_input]:text-title [&_input]:tracking-[0.3em] [&_input]:tabular-nums"
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Checking" : "Continue"}
        </Button>
      </form>
      <form action={resend}>
        {resent.message ? <Alert tone="positive" className="mb-3">{resent.message}</Alert> : null}
        {resent.error ? <Alert className="mb-3">{resent.error}</Alert> : null}
        <Button type="submit" variant="ghost" size="sm" disabled={resending} className="-ml-3">
          {resending ? "Sending" : "Send a new code"}
        </Button>
      </form>
    </div>
  );
}

export function SignUpForm({
  email,
  name,
  business,
  countries,
  defaultCountry,
  organisationTypes,
}: {
  email: string;
  name?: string | null;
  business: boolean;
  countries: { value: string; label: string }[];
  defaultCountry: string;
  organisationTypes: { value: string; label: string; description: string }[];
}) {
  const [state, action, pending] = useActionState(signUpAction, {} as ActionState);
  const [accountType, setAccountType] = useState(state.values?.accountType ?? (business ? "business" : "personal"));
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <p className="text-callout text-ink-muted">
        Signing up as <span className="font-semibold text-ink">{email}</span>
      </p>
      <TextField id="name" label="Your full name" autoComplete="name" required defaultValue={state.values?.name ?? name ?? ""} error={err.name} />
      <SelectField id="country" label="Country you buy from" options={countries} defaultValue={state.values?.country ?? defaultCountry} error={err.country} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-callout font-semibold text-ink">Who are you buying for?</legend>
        {[
          { value: "personal", label: "Myself", hint: "Retail prices, guest or account checkout." },
          { value: "business", label: "A business or organisation", hint: "Trade prices once we have verified it, quotes and a team account." },
        ].map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="accountType" value={o.value} checked={accountType === o.value} onChange={() => setAccountType(o.value)} className="mt-1 accent-[var(--t-primary)]" />
            <span>
              <span className="block font-semibold text-ink">{o.label}</span>
              <span className="block text-callout text-ink-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {accountType === "business" ? (
        <div className="flex flex-col gap-5 rounded-md border border-line bg-surface p-4">
          <TextField id="organisation" label="Organisation name" autoComplete="organization" required defaultValue={state.values?.organisation} error={err.organisation} />
          <SelectField
            id="organisationType"
            label="What kind of organisation?"
            options={organisationTypes.map((t) => ({ value: t.value, label: t.label }))}
            defaultValue={state.values?.organisationType ?? "BUSINESS"}
            error={err.organisationType}
            hint={organisationTypes.map((t) => `${t.label}: ${t.description}`).join(" ")}
          />
          <TextField id="registrationNumber" label="Company registration number (optional)" defaultValue={state.values?.registrationNumber} />
          <TextField id="taxNumber" label="Tax or VAT number (optional)" defaultValue={state.values?.taxNumber} />
        </div>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating your account" : "Create account"}
      </Button>
    </form>
  );
}
