"use client";

import { useActionState } from "react";
import { addLineAction, cancelQuoteAction, updateLineAction, updateQuoteRulesAction } from "@/app/admin/(console)/quote-actions";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

type Option = { value: string; label: string };
const initial = {} as ActionState;

export interface LineFormValues {
  description: string;
  quantity: string;
  reference: string;
  categoryId: string;
  cost: string;
  leadTimeDays: string;
  price: string;
}

/**
 * One quote line, checked by staff: what it is, the product it matches,
 * and a cost or price when no supplier gave one. Saving clears its flag.
 * `prefix` keeps the field ids apart when several lines share a page.
 */
export function QuoteLineForm({ quoteId, lineId, given, categories, base, currency, showCost }: { quoteId: string; lineId?: string; given: LineFormValues; categories: Option[]; base: string; currency: string; showCost: boolean }) {
  const [state, action, pending] = useActionState(lineId ? updateLineAction : addLineAction, initial);
  const v = state.ok || !state.values ? given : (state.values as unknown as LineFormValues);
  const err = state.fieldErrors ?? {};
  const p = lineId ? `l${lineId}` : "new";
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="quoteId" value={quoteId} />
      {lineId ? <input type="hidden" name="lineId" value={lineId} /> : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <TextField id={`${p}-description`} name="description" label="Item" defaultValue={v.description} error={err.description} />
        <TextField id={`${p}-quantity`} name="quantity" label="Quantity" inputMode="numeric" defaultValue={v.quantity} error={err.quantity} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id={`${p}-reference`} name="reference" label="Our product (optional)" defaultValue={v.reference} error={err.reference} hint="Its part number or web address. Leave empty for an item we don't list." />
        <SelectField id={`${p}-categoryId`} name="categoryId" label="Category" options={categories} placeholder="Not chosen" defaultValue={v.categoryId} error={err.categoryId} hint="For an item we don't list: decides which suppliers we ask." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {showCost ? <TextField id={`${p}-cost`} name="cost" label={`Landed cost each (${base}, optional)`} inputMode="decimal" defaultValue={v.cost} error={err.cost} hint="Replaces supplier prices for this line." /> : null}
        {showCost ? <TextField id={`${p}-leadTimeDays`} name="leadTimeDays" label="Days to deliver (optional)" inputMode="numeric" defaultValue={v.leadTimeDays} error={err.leadTimeDays} /> : null}
        <TextField id={`${p}-price`} name="price" label={`Price each before tax (${currency}, optional)`} inputMode="decimal" defaultValue={v.price} error={err.price} hint="Only to override the price the rules give." />
      </div>
      <Outcome state={state} />
      <div>
        <Button type="submit" variant={lineId ? "primary" : "secondary"} disabled={pending}>
          {pending ? "Saving" : lineId ? "Save line" : "Add line"}
        </Button>
      </div>
    </form>
  );
}

export function CancelQuoteForm({ quoteId }: { quoteId: string }) {
  const [state, action, pending] = useActionState(cancelQuoteAction, initial);
  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm("Cancel this quote? The customer is emailed and any open supplier requests close.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="quoteId" value={quoteId} />
      <TextField id="reason" label="Why, for the customer" defaultValue={state.ok ? "" : (state.values?.reason ?? "")} error={state.fieldErrors?.reason} />
      <Outcome state={state} />
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Cancelling" : "Cancel quote"}
        </Button>
      </div>
    </form>
  );
}

export interface RulesValues {
  automationEnabled: boolean;
  maxAutoValue: string;
  minMarginPercent: string;
  minMatchConfidence: string;
  supplierHours: string;
  urgentSupplierHours: string;
  validityDays: string;
  tenderMarkupPercent: string;
  projectMarkupPercent: string;
  tenderReminderHours: string;
}

/** The Admin's rules for quotes: when one goes out by itself, supplier deadlines, validity and markups. */
export function QuoteRulesForm({ given, base, canEdit }: { given: RulesValues; base: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateQuoteRulesAction, initial);
  const v = state.values && !state.ok ? { ...state.values, automationEnabled: state.values.automationEnabled === "on" } : given;
  const err = state.fieldErrors ?? {};
  const text = (k: Exclude<keyof RulesValues, "automationEnabled">) => String((v as Record<string, unknown>)[k] ?? "");
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h2 className="text-headline font-bold">Sending by itself</h2>
          <CheckboxField id="automationEnabled" label="Send quotes automatically when they meet every rule below" defaultChecked={Boolean(v.automationEnabled)} hint="Anything else waits in the review queue." />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField id="maxAutoValue" label={`Most it can be worth (${base}, before tax)`} inputMode="decimal" defaultValue={text("maxAutoValue")} error={err.maxAutoValue} />
            <TextField id="minMarginPercent" label="Lowest margin (%)" inputMode="decimal" defaultValue={text("minMarginPercent")} error={err.minMarginPercent} />
            <TextField id="minMatchConfidence" label="Surest match needed (0 to 100)" inputMode="numeric" defaultValue={text("minMatchConfidence")} error={err.minMatchConfidence} hint="100 is an exact part number." />
          </div>
          <p className="text-callout text-ink-muted">A quote with a flagged line, or from someone without an account, always waits for review.</p>
        </section>
        <section className="flex flex-col gap-4">
          <h2 className="text-headline font-bold">Suppliers and validity</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField id="supplierHours" label="Hours suppliers get to answer" inputMode="numeric" defaultValue={text("supplierHours")} error={err.supplierHours} />
            <TextField id="urgentSupplierHours" label="Hours when urgent" inputMode="numeric" defaultValue={text("urgentSupplierHours")} error={err.urgentSupplierHours} />
            <TextField id="validityDays" label="Days a quote is valid" inputMode="numeric" defaultValue={text("validityDays")} error={err.validityDays} />
          </div>
        </section>
        <section className="flex flex-col gap-4">
          <h2 className="text-headline font-bold">Markups and tenders</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField id="tenderMarkupPercent" label="Tender markup (%, optional)" inputMode="decimal" defaultValue={text("tenderMarkupPercent")} error={err.tenderMarkupPercent} hint="Empty: the category's or the price level's markup." />
            <TextField id="projectMarkupPercent" label="Reseller project markup (%, optional)" inputMode="decimal" defaultValue={text("projectMarkupPercent")} error={err.projectMarkupPercent} hint="Empty: the category's or the price level's markup." />
            <TextField id="tenderReminderHours" label="Remind staff this many hours before a tender closes" inputMode="numeric" defaultValue={text("tenderReminderHours")} error={err.tenderReminderHours} />
          </div>
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
