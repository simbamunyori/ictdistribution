import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "h-11 w-full rounded-md border border-line bg-raised px-3 text-body text-ink placeholder:text-ink-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus aria-invalid:border-negative disabled:opacity-60";

export interface FieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: (describedBy: string | undefined, invalid: boolean) => React.ReactNode;
  className?: string;
}

/** Label, control, then either the error or the hint below it. */
export function Field({ id, label, hint, error, children, className }: FieldProps) {
  const noteId = error || hint ? `${id}-note` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-callout font-semibold text-ink">
        {label}
      </label>
      {children(noteId, Boolean(error))}
      {error ? (
        <p id={noteId} className="text-callout text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-callout text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Base = { id: string; label: string; hint?: React.ReactNode; error?: string; className?: string };

export function TextField({ id, label, hint, error, className, ...props }: Base & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      {(describedBy, invalid) => <input id={id} name={props.name ?? id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={inputClass} {...props} />}
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  className,
  options,
  placeholder,
  ...props
}: Base & { options: { value: string; label: string }[]; placeholder?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      {(describedBy, invalid) => (
        <div className="relative">
          <select id={id} name={props.name ?? id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(inputClass, "appearance-none pr-10")} {...props}>
            {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted" />
        </div>
      )}
    </Field>
  );
}

export function CheckboxField({ id, label, hint, className, ...props }: Omit<Base, "error"> & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  const noteId = hint ? `${id}-note` : undefined;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} name={props.name ?? id} type="checkbox" aria-describedby={noteId} className="mt-1 size-4 shrink-0 accent-[var(--t-primary)]" {...props} />
      <div>
        <label htmlFor={id} className="text-body font-semibold text-ink">
          {label}
        </label>
        {hint ? (
          <p id={noteId} className="text-callout text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
