"use client";

import { useActionState } from "react";
import {
  addCurrencyAction,
  customerTypeAction,
  fetchRatesAction,
  inviteStaffAction,
  marketAction,
  rateRulesAction,
  setRateAction,
} from "@/app/admin/(console)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type Option = { value: string; label: string };

export function Outcome({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.message) return <Alert tone="positive">{state.message}</Alert>;
  return null;
}

export function CustomerTypeForm({
  type,
  readOnly,
}: {
  type: { code: string; name: string; description: string; markupPercent: string; guestCheckout: boolean; organisation: boolean };
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(customerTypeAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const id = (k: string) => `${type.code}-${k}`;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="code" value={type.code} />
      <div className="grid gap-4 md:grid-cols-[1fr_10rem]">
        <TextField id={id("name")} name="name" label="Name customers see" defaultValue={v.name ?? type.name} error={err.name} disabled={readOnly} />
        <TextField id={id("markup")} name="markupPercent" label="Markup %" inputMode="decimal" defaultValue={v.markupPercent ?? type.markupPercent} error={err.markupPercent} disabled={readOnly} hint="On our cost." />
      </div>
      <TextField id={id("description")} name="description" label="Description" defaultValue={v.description ?? type.description} error={err.description} disabled={readOnly} />
      {!type.organisation ? (
        <CheckboxField id={id("guest")} name="guestCheckout" label="Allow guest checkout" hint="Individuals can buy without making an account." defaultChecked={type.guestCheckout} disabled={readOnly} />
      ) : null}
      <Outcome state={state} />
      {readOnly ? null : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}

export interface MarketFormValues {
  code?: string;
  name: string;
  currency: string;
  locale: string;
  timeZone: string;
  fxBufferPercent: string;
  roundToMinor: string;
  supportEmail: string;
  sortOrder: string;
  enabled: boolean;
  isDefault: boolean;
}

export function MarketForm({ market, currencies, countries, readOnly }: { market: MarketFormValues; currencies: Option[]; countries?: Option[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(marketAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const creating = !market.code;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {market.code ? <input type="hidden" name="code" value={market.code} /> : null}
      {creating && countries ? <SelectField id="country" label="Country" options={countries} placeholder="Choose a country" defaultValue={v.country ?? ""} error={err.country} /> : null}
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="name" label="Name customers see" defaultValue={v.name ?? market.name} error={err.name} disabled={readOnly} />
        <SelectField id="currency" label="Currency" options={currencies} defaultValue={v.currency ?? market.currency} error={err.currency} disabled={readOnly} />
        <TextField id="locale" label="Number and date format" defaultValue={v.locale ?? market.locale} error={err.locale} disabled={readOnly} hint="A locale such as en-BW." />
        <TextField id="timeZone" label="Time zone" defaultValue={v.timeZone ?? market.timeZone} error={err.timeZone} disabled={readOnly} hint="Such as Africa/Gaborone." />
        <TextField
          id="fxBufferPercent"
          label="Exchange buffer %"
          inputMode="decimal"
          defaultValue={v.fxBufferPercent ?? market.fxBufferPercent}
          error={err.fxBufferPercent}
          disabled={readOnly}
          hint="Added to the exchange rate, to cover the rate moving before we pay. 0 when the currency is our own."
        />
        <TextField
          id="roundToMinor"
          label="Round prices up to"
          inputMode="numeric"
          defaultValue={v.roundToMinor ?? market.roundToMinor}
          error={err.roundToMinor}
          disabled={readOnly}
          hint="In cents or thebe: 100 rounds up to the next whole unit, 1 rounds to the cent."
        />
        <TextField id="supportEmail" label="Support email (optional)" type="email" defaultValue={v.supportEmail ?? market.supportEmail} error={err.supportEmail} disabled={readOnly} />
        <TextField id="sortOrder" label="Order in lists" inputMode="numeric" defaultValue={v.sortOrder ?? market.sortOrder} error={err.sortOrder} disabled={readOnly} />
      </div>
      <CheckboxField id="enabled" label="Open to customers" hint="Customers can choose it and see prices in its currency." defaultChecked={market.enabled} disabled={readOnly} />
      <CheckboxField id="isDefault" label="Default market" hint="For visitors whose country we can't tell or don't serve." defaultChecked={market.isDefault} disabled={readOnly} />
      {err.isDefault ? <Alert>{err.isDefault}</Alert> : null}
      {err.enabled ? <Alert>{err.enabled}</Alert> : null}
      <Outcome state={state} />
      {readOnly ? null : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : creating ? "Add market" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function AddCurrencyForm() {
  const [state, action, pending] = useActionState(addCurrencyAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <TextField id="currency-code" name="code" label="Code" maxLength={3} className="md:w-28" defaultValue={state.values?.code} error={err.code} hint="Such as NAD." />
        <TextField id="currency-name" name="name" label="Name" className="md:flex-1" defaultValue={state.values?.name} error={err.name} />
        <div className="md:pt-7">
          <Button type="submit" variant="secondary" disabled={pending} className="w-full md:w-auto">
            {pending ? "Adding" : "Add currency"}
          </Button>
        </div>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function FetchRatesButton() {
  const [state, action, pending] = useActionState(fetchRatesAction, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Fetching" : "Fetch rates now"}
        </Button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function SetRateForm({ base, currencies }: { base: string; currencies: Option[] }) {
  const [state, action, pending] = useActionState(setRateAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <SelectField id="quote" label={`1 ${base} buys`} options={currencies} defaultValue={state.values?.quote} error={err.quote} className="md:w-44" />
        <TextField id="rate" label="Rate" inputMode="decimal" placeholder="13.6512" className="md:flex-1" defaultValue={state.values?.rate} error={err.rate} />
        <div className="md:pt-7">
          <Button type="submit" variant="secondary" disabled={pending} className="w-full md:w-auto">
            {pending ? "Saving" : "Use this rate"}
          </Button>
        </div>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function RateRulesForm({ holdPercent, maxAgeHours }: { holdPercent: string; maxAgeHours: string }) {
  const [state, action, pending] = useActionState(rateRulesAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="holdPercent" label="Hold back a rate that moves more than (%)" inputMode="decimal" defaultValue={state.values?.holdPercent ?? holdPercent} error={err.holdPercent} />
        <TextField id="maxAgeHours" label="Warn when a rate is older than (hours)" inputMode="numeric" defaultValue={state.values?.maxAgeHours ?? maxAgeHours} error={err.maxAgeHours} />
      </div>
      <Outcome state={state} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving" : "Save rules"}
        </Button>
      </div>
    </form>
  );
}

export function InviteStaffForm({ roles }: { roles: Option[] }) {
  const [state, action, pending] = useActionState(inviteStaffAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_12rem]">
        <TextField id="name" label="Full name" autoComplete="off" defaultValue={state.values?.name} error={err.name} />
        <TextField id="email" label="Work email" type="email" autoComplete="off" defaultValue={state.values?.email} error={err.email} />
        <SelectField id="role" label="Role" options={roles} defaultValue={state.values?.role ?? "SALES"} error={err.role} />
      </div>
      <Outcome state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}
