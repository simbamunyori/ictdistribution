import { Building2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** "Buying for a business?" with the way to register. Shown across the shop. */
export function BusinessPrompt({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-callout", className)}>
      <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
      <span>
        Buying for a business?{" "}
        <Link href="/sign-up?for=business" className="font-semibold text-link underline underline-offset-4">
          Register for trade prices
        </Link>
        , quotes and credit terms.
      </span>
    </p>
  );
}
