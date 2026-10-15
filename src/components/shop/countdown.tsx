"use client";

import { useEffect, useState } from "react";
import { timeLeft } from "@/lib/shop-pricing";

/**
 * "Ends in 3 h 20 min", updated every minute. The server sends the end
 * date as text, which shows until the browser takes over, so the page
 * reads the same without JavaScript.
 */
export function Countdown({ endsAt, fallback, className }: { endsAt: string; fallback: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const end = new Date(endsAt);
    const tick = () => setText(timeLeft(end, new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return (
    <time dateTime={endsAt} className={className}>
      {text ?? fallback}
    </time>
  );
}
