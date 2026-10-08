import * as React from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-raised p-5 md:p-6", className)} {...props} />;
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-title font-bold">{title}</h1>
        {lead ? <p className="mt-1 max-w-2xl text-ink-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "positive" | "warning" | "negative" | "highlight"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-surface text-ink-muted",
    positive: "bg-positive-soft text-positive",
    warning: "bg-warning-soft text-warning",
    negative: "bg-negative-soft text-negative",
    highlight: "bg-highlight text-on-highlight",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold", tones[tone])}>{children}</span>;
}

/**
 * A table that scrolls sideways inside itself on a phone, never the page.
 * Relative, so screen-reader-only text inside stays inside it; focusable
 * and named, so keyboard users can scroll it too.
 */
export function TableWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative -mx-5 overflow-x-auto px-5 focus-visible:outline-2 focus-visible:outline-focus md:mx-0 md:px-0">
      {children}
    </div>
  );
}

export const th = "border-b border-line py-2 pr-4 text-left text-caption font-semibold text-ink-muted uppercase";
export const td = "border-b border-line py-3 pr-4 align-top";
