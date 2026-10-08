"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import type { ActionState } from "@/server/action-state";

/**
 * A small form around one server action: hidden values, a button, and the
 * action's message or error under it. For one-click changes in lists.
 */
export function ActionForm({
  action,
  hidden = {},
  label,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  children,
  className,
  confirm,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
  className?: string;
  /** Asked before submitting, for changes that are awkward to undo. */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <Button type="submit" variant={variant} size={size} disabled={pending}>
          {pending ? (pendingLabel ?? label) : label}
        </Button>
      </div>
      {state.error ? <Alert className="mt-2">{state.error}</Alert> : null}
      {state.fieldErrors ? <Alert className="mt-2">{Object.values(state.fieldErrors)[0]}</Alert> : null}
      {state.message ? <Alert tone="positive" className="mt-2">{state.message}</Alert> : null}
    </form>
  );
}
