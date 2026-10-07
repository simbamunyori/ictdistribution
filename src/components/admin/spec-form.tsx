"use client";

import { useActionState } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { CheckboxField, FileField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

/**
 * A form described by its fields, for the many small admin forms that are
 * only labels and inputs. What was typed comes back after a mistake, with
 * each field's error under it.
 */

type Common = { id: string; label: string; hint?: string; wide?: boolean };
export type FieldSpec =
  | (Common & { kind: "text"; defaultValue?: string; inputMode?: "decimal" | "numeric" | "text"; type?: "text" | "date" | "email"; placeholder?: string; autoComplete?: string })
  | (Common & { kind: "select"; options: { value: string; label: string }[]; defaultValue?: string; placeholder?: string })
  | (Common & { kind: "textarea"; defaultValue?: string; rows?: number })
  | (Common & { kind: "checkbox"; defaultChecked?: boolean })
  | (Common & { kind: "file"; accept?: string });

export function SpecForm({
  action,
  fields,
  hidden = {},
  submitLabel,
  pendingLabel,
  confirm,
  variant = "primary",
  disabled = false,
  columns = 2,
  idPrefix = "",
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  fields: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  /** Asked before submitting. */
  confirm?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
  /** Keeps ids apart when one page has several of the same form. */
  idPrefix?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const sent = state.values && !state.ok ? state.values : null;
  const err = state.fieldErrors ?? {};
  const grid = columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset disabled={disabled} className={cn("grid gap-4", grid)}>
        {fields.map((f) => {
          const id = `${idPrefix}${f.id}`;
          const span = f.wide || f.kind === "textarea" || f.kind === "checkbox" ? "sm:col-span-full" : "";
          const value = sent ? (sent[f.id] ?? "") : undefined;
          switch (f.kind) {
            case "text":
              return <TextField key={f.id} id={id} name={f.id} label={f.label} hint={f.hint} type={f.type ?? "text"} inputMode={f.inputMode} placeholder={f.placeholder} autoComplete={f.autoComplete ?? "off"} defaultValue={value ?? f.defaultValue ?? ""} error={err[f.id]} className={span} />;
            case "select":
              return <SelectField key={f.id} id={id} name={f.id} label={f.label} hint={f.hint} options={f.options} placeholder={f.placeholder} defaultValue={value ?? f.defaultValue ?? ""} error={err[f.id]} className={span} />;
            case "textarea":
              return <TextAreaField key={f.id} id={id} name={f.id} label={f.label} hint={f.hint} rows={f.rows ?? 3} defaultValue={value ?? f.defaultValue ?? ""} error={err[f.id]} className={span} />;
            case "checkbox":
              return <CheckboxField key={f.id} id={id} name={f.id} label={f.label} hint={f.hint} defaultChecked={sent ? sent[f.id] === "on" : f.defaultChecked} className={span} />;
            case "file":
              return <FileField key={f.id} id={id} name={f.id} label={f.label} hint={f.hint} accept={f.accept} error={err[f.id]} className={span} />;
          }
        })}
      </fieldset>
      {children}
      <Outcome state={state} />
      {disabled ? null : (
        <div>
          <Button type="submit" variant={variant} disabled={pending}>
            {pending ? (pendingLabel ?? submitLabel) : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
