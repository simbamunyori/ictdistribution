"use client";

import { useActionState, useState } from "react";
import { createListAction, renameListAction, requestReturnAction, saveToListAction, setListLineAction } from "@/app/(site)/account/portal-actions";
import { Outcome } from "@/components/admin/forms";
import { Button } from "@/components/ui/button";
import { inputClass, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

type Option = { value: string; label: string };
const NEW = "";

/** On a product page: save it, with how many, to one of the customer's lists or a new one. */
export function SaveToListForm({ productId, lists, back }: { productId: string; lists: Option[]; back: string }) {
  const [state, action, pending] = useActionState(saveToListAction, {} as ActionState);
  const [listId, setListId] = useState(lists[0]?.value ?? NEW);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={back} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <SelectField id="listId" label="Save to" options={[...lists, { value: NEW, label: "A new list" }]} value={listId} onChange={(e) => setListId(e.target.value)} />
        <TextField id="list-quantity" name="quantity" label="How many" inputMode="numeric" defaultValue="1" error={err.quantity} />
      </div>
      {listId === NEW ? <TextField id="list-name" name="name" label="Name the new list" placeholder="Monthly office kit" defaultValue={state.values?.name ?? ""} error={err.name} /> : null}
      <Outcome state={state} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving" : "Save to list"}
        </Button>
      </div>
    </form>
  );
}

/** A name and a button: a new list, or a cart or order saved as a list. */
export function NameListForm({ action, hidden = {}, label, defaultName = "", idPrefix = "" }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; hidden?: Record<string, string>; label: string; defaultName?: string; idPrefix?: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField id={`${idPrefix}name`} name="name" label="List name" defaultValue={state.values?.name ?? defaultName} error={state.fieldErrors?.name} className="flex-1" />
        <div className={state.fieldErrors?.name ? "sm:mb-7" : undefined}>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving" : label}
          </Button>
        </div>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function CreateListForm() {
  return <NameListForm action={createListAction} label="Start a list" idPrefix="new-" />;
}

export function RenameListForm({ listId, name }: { listId: string; name: string }) {
  return <NameListForm action={renameListAction} hidden={{ listId }} label="Rename" defaultName={name} idPrefix="rename-" />;
}

/** One product on a list: change how many, or take it off. */
export function ListLineForm({ listId, lineId, quantity, label }: { listId: string; lineId: string; quantity: number; label: string }) {
  const [state, action, pending] = useActionState(setListLineAction, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex items-center gap-2">
        <label htmlFor={`qty-${lineId}`} className="sr-only">
          How many {label}
        </label>
        <input id={`qty-${lineId}`} name="quantity" inputMode="numeric" defaultValue={quantity} className={`${inputClass} w-20`} />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Save
        </Button>
        <Button type="submit" size="sm" variant="ghost" name="remove" value="1" disabled={pending}>
          Remove
        </Button>
      </div>
      {state.error ? <p className="text-callout text-negative">{state.error}</p> : null}
      {state.fieldErrors ? <p className="text-callout text-negative">{Object.values(state.fieldErrors)[0]}</p> : null}
    </form>
  );
}

export interface ReturnLineChoice {
  id: string;
  description: string;
  mpn: string;
  sent: number;
  available: number;
}

/** Which items to send back from an order, and why. */
export function ReturnForm({ orderNumber, lines, reasons, window }: { orderNumber: string; lines: ReturnLineChoice[]; reasons: Option[]; window: string }) {
  const [state, action, pending] = useActionState(requestReturnAction, {} as ActionState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-ink">How many of each to return</legend>
        {lines.map((l) => (
          <div key={l.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center">
            <div>
              <label htmlFor={`qty-${l.id}`} className="font-semibold text-ink">
                {l.description}
              </label>
              <p id={`qty-${l.id}-note`} className="text-callout text-ink-muted">
                {l.mpn ? `Part ${l.mpn}. ` : ""}
                {l.available ? `Up to ${l.available} of ${l.sent} sent.` : "Nothing more of this can be returned."}
              </p>
              {err[`qty-${l.id}`] ? <p id={`qty-${l.id}-error`} className="text-callout font-semibold text-negative">{err[`qty-${l.id}`]}</p> : null}
            </div>
            <input id={`qty-${l.id}`} name={`qty-${l.id}`} inputMode="numeric" defaultValue={v[`qty-${l.id}`] ?? ""} disabled={!l.available} placeholder="0" aria-describedby={err[`qty-${l.id}`] ? `qty-${l.id}-note qty-${l.id}-error` : `qty-${l.id}-note`} aria-invalid={err[`qty-${l.id}`] ? true : undefined} className={inputClass} />
          </div>
        ))}
      </fieldset>
      <SelectField id="reason" label="Why" options={reasons} placeholder="Choose a reason" defaultValue={v.reason ?? ""} error={err.reason} hint={window} />
      <TextAreaField id="details" label="What is wrong" rows={4} defaultValue={v.details ?? ""} error={err.details} hint="For a fault, say what happens and give the serial number if you have it." />
      <Outcome state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending" : "Ask for the return"}
        </Button>
      </div>
    </form>
  );
}
