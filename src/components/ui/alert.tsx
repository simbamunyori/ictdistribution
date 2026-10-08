import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

const TONES = {
  negative: { box: "bg-negative-soft text-negative", Icon: CircleAlert },
  positive: { box: "bg-positive-soft text-positive", Icon: CircleCheck },
  info: { box: "bg-info-soft text-info", Icon: Info },
  warning: { box: "bg-warning-soft text-warning", Icon: TriangleAlert },
} as const;

/** An inline message. Errors and warnings are announced to screen readers. */
export function Alert({ tone = "negative", children, className }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={tone === "negative" || tone === "warning" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md px-4 py-3 text-callout", box, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="text-ink">{children}</div>
    </div>
  );
}
