import { Clock, Tag } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import { cn } from "@/lib/cn";
import type { ShopPrice } from "@/server/shop/prices";
import { Countdown } from "./countdown";

/** The shop price, with the usual price struck through and a countdown when a special applies. */
export function PriceTag({ price, locale, timeZone, taxName, size = "md", showSpecial = true }: { price: Pick<ShopPrice, "amount" | "was" | "special"> & { agreed?: boolean }; locale: string; timeZone: string; taxName?: string; size?: "md" | "lg"; showSpecial?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("font-bold text-ink tabular-nums", size === "lg" ? "text-title" : "text-headline")}>{formatMoney(price.amount, locale)}</span>
        {price.was ? (
          <span className="text-callout text-ink-muted line-through tabular-nums">
            <span className="sr-only">Usual price </span>
            {formatMoney(price.was, locale)}
          </span>
        ) : null}
        {taxName ? <span className="text-caption text-ink-muted">including {taxName}</span> : null}
      </p>
      {price.agreed ? <p className="text-caption font-semibold text-link">Your agreed price</p> : null}
      {showSpecial && price.special ? <SpecialLine special={price.special} locale={locale} timeZone={timeZone} /> : null}
    </div>
  );
}

export function SpecialLine({ special, locale, timeZone }: { special: { name: string; endsAt: Date; remaining: number | null }; locale: string; timeZone: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption font-semibold">
      <span className="inline-flex items-center gap-1 text-link">
        <Tag aria-hidden className="size-3.5" />
        {special.name}
      </span>
      <span className="inline-flex items-center gap-1 text-ink-muted">
        <Clock aria-hidden className="size-3.5" />
        <Countdown endsAt={special.endsAt.toISOString()} fallback={`Ends ${formatDateTime(special.endsAt, locale, timeZone)}`} />
      </span>
      {special.remaining !== null && special.remaining <= 20 ? <span className="text-ink-muted">{special.remaining} left</span> : null}
    </p>
  );
}

/** "Ships in about 3 working days", from the typical lead time. */
export function leadTimeText(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 1) return "Usually ready the next working day.";
  return `Usually ready in about ${days} working days.`;
}
