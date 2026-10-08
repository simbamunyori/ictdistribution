import type { Market } from "@prisma/client";
import { ChevronDown, Globe } from "lucide-react";
import { chooseMarketAction } from "@/app/(site)/actions";

/** The country and currency prices are in. Works without JavaScript: each choice is its own small form. */
export function MarketSwitcher({ current, markets, back }: { current: Market; markets: Market[]; back: string }) {
  return (
    <details className="group relative">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-callout font-semibold text-ink hover:bg-surface [&::-webkit-details-marker]:hidden">
        <Globe aria-hidden className="size-4 text-ink-muted" />
        <span className="sr-only">Country and currency: </span>
        {current.country} · {current.currency}
        <ChevronDown aria-hidden className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-line bg-raised p-2 shadow-lg">
        <p className="px-2 pt-1 pb-2 text-caption text-ink-muted">Where are you buying from?</p>
        {markets.map((m) => (
          <form key={m.code} action={chooseMarketAction}>
            <input type="hidden" name="market" value={m.code} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" aria-current={m.code === current.code ? "true" : undefined} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-body text-ink hover:bg-surface aria-[current]:font-semibold">
              {m.name}
              <span className="text-callout text-ink-muted">{m.currency}</span>
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
