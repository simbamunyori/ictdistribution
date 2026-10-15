"use client";

import { useActionState, useState } from "react";
import {
  addCollectionPointAction,
  addFeaturedAction,
  cancelOrderAction,
  consignmentAction,
  fulfilOrderAction,
  marketDeliveryAction,
  marketTaxAction,
  recordPaymentAction,
  shopSettingsAction,
  specialAction,
} from "@/app/admin/(console)/shop-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

type Option = { value: string; label: string };
const initial = {} as ActionState;
const BUNDLE_SLOTS = 6;

function Submit({ pending, label, pendingLabel = "Saving", variant }: { pending: boolean; label: string; pendingLabel?: string; variant?: "primary" | "secondary" | "destructive" }) {
  return (
    <div>
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
    </div>
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

// ─── Specials ────────────────────────────────────────────────────────

export interface SpecialFormValues {
  id?: string;
  name: string;
  description: string;
  kind: string;
  items: { reference: string; quantity: string }[];
  categoryId: string;
  mode: string;
  percent: string;
  price: string;
  marketCode: string;
  startsAt: string;
  endsAt: string;
  quantityLimit: string;
  perOrderLimit: string;
  customerTypes: string[];
  featured: boolean;
  active: boolean;
}

const KINDS: Option[] = [
  { value: "PRODUCT", label: "One product" },
  { value: "CATEGORY", label: "A whole category" },
  { value: "BUNDLE", label: "A bundle of products" },
];

/**
 * A special, or (with `consignment`) stock we bring in launched as a
 * special on one product, limited to the units that arrived.
 */
export function SpecialForm({
  special,
  categories,
  markets,
  customerTypes,
  readOnly,
  used = 0,
  consignment,
}: {
  special: SpecialFormValues;
  categories: Option[];
  markets: (Option & { currency: string; taxName: string })[];
  customerTypes: Option[];
  readOnly: boolean;
  used?: number;
  consignment?: { currencies: Option[]; defaultCurrency: string };
}) {
  const [state, action, pending] = useActionState(consignment ? consignmentAction : specialAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [kind, setKind] = useState(consignment ? "PRODUCT" : (v.kind ?? special.kind));
  const [mode, setMode] = useState(v.mode ?? special.mode);
  const [marketCode, setMarketCode] = useState(v.marketCode ?? special.marketCode);
  const market = markets.find((m) => m.value === marketCode);
  const chosenTypes = v.customerTypes !== undefined ? v.customerTypes.split(",") : special.customerTypes;
  const slots = kind === "BUNDLE" ? BUNDLE_SLOTS : 1;
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {special.id ? <input type="hidden" name="id" value={special.id} /> : null}
      {consignment ? <input type="hidden" name="kind" value="PRODUCT" /> : null}

      {consignment ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-headline font-bold">The stock</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField id="product" label="Product" defaultValue={v.product ?? ""} error={err.product} hint="Its part number, or its address in the shop. Add the product first if it is new." disabled={readOnly} />
            <TextField id="units" label="Units that arrived" inputMode="numeric" defaultValue={v.units ?? ""} error={err.units} hint="The special stops when these are sold." disabled={readOnly} />
            <TextField id="unitCost" label="Landed cost per unit" inputMode="decimal" defaultValue={v.unitCost ?? ""} error={err.unitCost} hint="Including freight and duty. Staff only, never shown to customers." disabled={readOnly} />
            <SelectField id="currency" label="Cost currency" options={consignment.currencies} defaultValue={v.currency ?? consignment.defaultCurrency} error={err.currency} disabled={readOnly} />
          </div>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-headline font-bold">{consignment ? "The special" : "What it is"}</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField id="name" label="Name customers see" defaultValue={v.name ?? special.name} error={err.name} hint="Such as ThinkPad launch week." disabled={readOnly} />
          {consignment ? null : <SelectField id="kind" label="On" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} error={err.kind} disabled={readOnly || used > 0} hint={used > 0 ? "Fixed once orders use the special." : undefined} />}
        </div>
        <TextAreaField id="description" label="A line about it (optional)" rows={2} defaultValue={v.description ?? special.description} error={err.description} disabled={readOnly} />
        {consignment ? null : kind === "CATEGORY" ? (
          <SelectField id="categoryId" label="Category" options={categories} placeholder="Choose a category" defaultValue={v.categoryId ?? special.categoryId} error={err.categoryId} hint="Everything in it and the categories under it." disabled={readOnly} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-callout font-semibold">{kind === "BUNDLE" ? "Products in the bundle (two to six)" : "Product"}</p>
            {Array.from({ length: slots }, (_, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <TextField id={`item${i}Ref`} label={kind === "BUNDLE" ? `Product ${i + 1}, part number or address` : "Part number or address"} defaultValue={v[`item${i}Ref`] ?? special.items[i]?.reference ?? ""} disabled={readOnly} />
                {kind === "BUNDLE" ? <TextField id={`item${i}Qty`} label="How many" inputMode="numeric" defaultValue={v[`item${i}Qty`] ?? special.items[i]?.quantity ?? "1"} disabled={readOnly} /> : null}
              </div>
            ))}
            {err.items ? <p className="text-callout text-negative">{err.items}</p> : null}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-headline font-bold">Price</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            id="mode"
            label="Discount"
            options={[{ value: "percent", label: "A percentage off the shop price" }, ...(kind === "CATEGORY" ? [] : [{ value: "price", label: "A fixed price" }])]}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            error={err.mode}
            disabled={readOnly}
          />
          <SelectField id="marketCode" label="Market" options={markets} placeholder="Every market" value={marketCode} onChange={(e) => setMarketCode(e.target.value)} error={err.marketCode} hint={mode === "price" ? "A fixed price is for one market." : undefined} disabled={readOnly} />
          {mode === "price" ? (
            <TextField id="price" label={`Price${market ? ` in ${market.currency}, including ${market.taxName}` : ""}`} inputMode="decimal" defaultValue={v.price ?? special.price} error={err.price} hint={kind === "BUNDLE" ? "For the whole bundle." : "Per unit."} disabled={readOnly} />
          ) : (
            <TextField id="percent" label="Percentage off" inputMode="decimal" defaultValue={v.percent ?? special.percent} error={err.percent} hint={kind === "BUNDLE" ? "Off the products bought separately." : undefined} disabled={readOnly} />
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-headline font-bold">When and how many</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField id="startsAt" label="Starts" type="datetime-local" defaultValue={v.startsAt ?? special.startsAt} error={err.startsAt} hint="Gaborone time." disabled={readOnly} />
          <TextField id="endsAt" label="Ends" type="datetime-local" defaultValue={v.endsAt ?? special.endsAt} error={err.endsAt} hint="Customers see a countdown to this." disabled={readOnly} />
          {consignment ? null : <TextField id="quantityLimit" label="Units on offer (optional)" inputMode="numeric" defaultValue={v.quantityLimit ?? special.quantityLimit} error={err.quantityLimit} hint={used ? `${used} taken by orders so far.` : "Empty for no limit."} disabled={readOnly} />}
          <TextField id="perOrderLimit" label="Most per order (optional)" inputMode="numeric" defaultValue={v.perOrderLimit ?? special.perOrderLimit} error={err.perOrderLimit} hint="More than this are charged the usual price." disabled={readOnly} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-headline font-bold">Who gets it</legend>
        {customerTypes.map((t) => (
          <CheckboxField key={t.value} id={`customerTypes-${t.value}`} name="customerTypes" value={t.value} label={t.label} defaultChecked={chosenTypes.includes(t.value)} disabled={readOnly} />
        ))}
        {err.customerTypes ? <p className="text-callout text-negative">{err.customerTypes}</p> : null}
        <p className="text-callout text-ink-muted">Until trade prices open, only products sold to individuals have shop prices, so specials apply to those.</p>
      </fieldset>

      <div className="flex flex-col gap-3">
        <CheckboxField id="featured" label="Show on the home page" defaultChecked={v.featured !== undefined ? v.featured === "on" : special.featured} disabled={readOnly} />
        {consignment ? null : <CheckboxField id="active" label="Switched on" hint="Switch it off to pause it without losing its settings." defaultChecked={v.active !== undefined ? v.active === "on" : special.active} disabled={readOnly} />}
      </div>

      <FormErrors state={state} />
      {readOnly ? null : <Submit pending={pending} label={consignment ? "Launch the special" : special.id ? "Save" : "Add special"} pendingLabel={consignment ? "Launching" : "Saving"} />}
    </form>
  );
}

// ─── Home page and shop settings ─────────────────────────────────────

export function ShopSettingsForm({ settings, readOnly }: { settings: { heroTitle: string; heroText: string; payDays: string; maxLineQuantity: string; returnDays: string }; readOnly: boolean }) {
  const [state, action, pending] = useActionState(shopSettingsAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <TextField id="heroTitle" label="Home page headline" defaultValue={v.heroTitle ?? settings.heroTitle} error={err.heroTitle} disabled={readOnly} />
      <TextAreaField id="heroText" label="Line under it" rows={2} defaultValue={v.heroText ?? settings.heroText} error={err.heroText} disabled={readOnly} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="payDays" label="Days to pay by bank transfer" inputMode="numeric" defaultValue={v.payDays ?? settings.payDays} error={err.payDays} hint="Unpaid orders are cancelled after this, and their special units go back on sale." disabled={readOnly} />
        <TextField id="maxLineQuantity" label="Most of one item in a cart" inputMode="numeric" defaultValue={v.maxLineQuantity ?? settings.maxLineQuantity} error={err.maxLineQuantity} hint="Larger orders are for business accounts." disabled={readOnly} />
        <TextField id="returnDays" label="Days to ask for a return" inputMode="numeric" defaultValue={v.returnDays ?? settings.returnDays} error={err.returnDays} hint="Counted from when the order was sent or made ready. Faulty items can be sent back at any time." disabled={readOnly} />
      </div>
      <FormErrors state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save" />}
    </form>
  );
}

export function AddFeaturedForm() {
  const [state, action, pending] = useActionState(addFeaturedAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField id="reference" label="Add a product" defaultValue={state.ok ? "" : (state.values?.reference ?? "")} error={state.fieldErrors?.reference} hint="Its part number, or its address in the shop." className="flex-1" key={state.ok ? "done" : "open"} />
        <div className="sm:mb-7">
          <Submit pending={pending} label="Add" pendingLabel="Adding" variant="secondary" />
        </div>
      </div>
      <Outcome state={state} />
    </form>
  );
}

// ─── Selling in a market ─────────────────────────────────────────────

export function MarketTaxForm({ code, values, readOnly }: { code: string; values: { taxName: string; taxPercent: string; taxNumber: string; bankDetails: string }; readOnly: boolean }) {
  const [state, action, pending] = useActionState(marketTaxAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="code" value={code} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="taxName" label="Tax name" defaultValue={v.taxName ?? values.taxName} error={err.taxName} hint="Shown with prices, such as VAT." disabled={readOnly} />
        <TextField id="taxPercent" label="Tax rate, percent" inputMode="decimal" defaultValue={v.taxPercent ?? values.taxPercent} error={err.taxPercent} hint="Shop prices include it." disabled={readOnly} />
        <TextField id="taxNumber" label="Our tax number here (optional)" defaultValue={v.taxNumber ?? values.taxNumber} error={err.taxNumber} hint="Printed on tax invoices." disabled={readOnly} />
      </div>
      <TextAreaField id="bankDetails" label="Bank details for transfers" rows={5} defaultValue={v.bankDetails ?? values.bankDetails} error={err.bankDetails} hint="Account name, bank, branch, account number and SWIFT code. Sent with every order. Leave empty to stop orders in this market." disabled={readOnly} />
      <FormErrors state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save" />}
    </form>
  );
}

export function MarketDeliveryForm({ code, currency, values, readOnly }: { code: string; currency: string; values: { deliveryEnabled: boolean; deliveryFee: string; freeDeliveryFrom: string; deliveryNote: string }; readOnly: boolean }) {
  const [state, action, pending] = useActionState(marketDeliveryAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="code" value={code} />
      <CheckboxField id="deliveryEnabled" label="We deliver in this market" defaultChecked={values.deliveryEnabled} disabled={readOnly} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="deliveryFee" label={`Delivery fee in ${currency}`} inputMode="decimal" defaultValue={v.deliveryFee ?? values.deliveryFee} error={err.deliveryFee} hint="Including tax. 0 for free." disabled={readOnly} />
        <TextField id="freeDeliveryFrom" label={`Free delivery from, in ${currency} (optional)`} inputMode="decimal" defaultValue={v.freeDeliveryFrom ?? values.freeDeliveryFrom} error={err.freeDeliveryFrom} disabled={readOnly} />
      </div>
      <TextAreaField id="deliveryNote" label="Delivery note for customers" rows={2} defaultValue={v.deliveryNote ?? values.deliveryNote} error={err.deliveryNote} hint="Such as where you deliver and how long it takes." disabled={readOnly} />
      <FormErrors state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save" />}
    </form>
  );
}

export function CollectionPointForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(addCollectionPointAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate key={state.ok ? `done-${state.message}` : "open"}>
      <input type="hidden" name="code" value={code} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="cp-name" name="name" label="Name" defaultValue={v.name ?? ""} error={err.name} hint="Such as Gaborone office." />
        <TextField id="cp-hours" name="hours" label="Opening hours (optional)" defaultValue={v.hours ?? ""} error={err.hours} hint="Such as Mon to Fri, 8:00 to 17:00." />
      </div>
      <TextAreaField id="cp-address" name="address" label="Address" rows={2} defaultValue={v.address ?? ""} error={err.address} />
      <FormErrors state={state} />
      <Submit pending={pending} label="Add collection point" pendingLabel="Adding" variant="secondary" />
    </form>
  );
}

// ─── Orders ──────────────────────────────────────────────────────────

export function PaymentForm({ orderId, currency, owing, today }: { orderId: string; currency: string; owing: string; today: string }) {
  const [state, action, pending] = useActionState(recordPaymentAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField id="amount" label={`Amount received, ${currency}`} inputMode="decimal" defaultValue={v.amount ?? owing} error={err.amount} />
        <TextField id="reference" label="Bank reference (optional)" defaultValue={v.reference ?? ""} error={err.reference} />
        <TextField id="receivedOn" label="Arrived on" type="date" defaultValue={v.receivedOn ?? today} error={err.receivedOn} />
      </div>
      <FormErrors state={state} />
      <Submit pending={pending} label="Record payment" pendingLabel="Recording" />
    </form>
  );
}

export function FulfilForm({ orderId, collection }: { orderId: string; collection: boolean }) {
  const [state, action, pending] = useActionState(fulfilOrderAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <TextField id="note" label="Note for the customer (optional)" hint={collection ? "Such as who to ask for." : "Such as the courier and tracking number."} />
      <Outcome state={state} />
      <Submit pending={pending} label={collection ? "Mark ready to collect" : "Mark as sent"} />
    </form>
  );
}

export function CancelOrderForm({ orderId, paid }: { orderId: string; paid: boolean }) {
  const [state, action, pending] = useActionState(cancelOrderAction, initial);
  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm("Cancel this order? The customer is emailed and special units go back on sale.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={orderId} />
      <TextField id="reason" label="Why, for the customer" defaultValue={state.ok ? "" : (state.values?.reason ?? "")} error={state.fieldErrors?.reason} hint={paid ? "Money was received, so arrange the refund too." : undefined} />
      <Outcome state={state} />
      <Submit pending={pending} label="Cancel order" pendingLabel="Cancelling" variant="destructive" />
    </form>
  );
}
