"use client";

import { useActionState, useRef, useState } from "react";
import { askAssistantAction, handOverAction } from "@/app/(site)/assistant-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";

const initial = {} as ActionState;

/** What the visitor types. Clears after each answer; Enter sends, Shift and Enter starts a new line. */
export function AskForm({ start = "", first }: { start?: string; first: boolean }) {
  const [state, action, pending] = useActionState(askAssistantAction, initial);
  const [text, setText] = useState(start);
  const form = useRef<HTMLFormElement>(null);
  // Clear the box once an answer comes back.
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.ok) setText("");
  }
  return (
    <form ref={form} action={action} className="flex flex-col gap-3" noValidate>
      <TextAreaField
        id="text"
        label={first ? "What are you looking for?" : "Your reply"}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !pending) {
            e.preventDefault();
            form.current?.requestSubmit();
          }
        }}
        error={state.fieldErrors?.text}
        hint={first ? "Such as: laptops for a 20 person office under P12,000 each, or a UPS for two servers." : undefined}
        maxLength={2000}
      />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Looking" : "Send"}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Looking for products." : state.ok ? "The assistant answered." : ""}
      </p>
    </form>
  );
}

/** Passing the conversation to Sales. */
export function HandoverForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(handOverAction, initial);
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField id="name" label="Your name" autoComplete="name" defaultValue={v.name ?? name} error={err.name} />
      <TextField id="email" label="Email" type="email" autoComplete="email" defaultValue={v.email ?? email} error={err.email} />
      <TextField id="phone" label="Phone (optional)" type="tel" autoComplete="tel" defaultValue={v.phone ?? ""} />
      <TextAreaField id="note" label="Anything to add (optional)" rows={2} defaultValue={v.note ?? ""} className="sm:col-span-2" />
      {state.error ? <Alert className="sm:col-span-2">{state.error}</Alert> : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending" : "Pass this to Sales"}
        </Button>
      </div>
    </form>
  );
}
