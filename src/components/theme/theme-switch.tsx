"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { THEME_COOKIE, themeAttribute, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Saves the choice and switches this page to it. */
function applyTheme(next: Theme) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  const attr = themeAttribute(next);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
}

/**
 * Light, dark or the device's setting. The choice is a cookie the root
 * layout reads, so the next page renders in it with no flash; this page
 * switches at once by setting data-theme on <html> and refreshes.
 */
export function ThemeSwitch({ current, onDark = false, className }: { current: Theme; onDark?: boolean; className?: string }) {
  const [theme, setTheme] = useState(current);
  const name = useId();
  const router = useRouter();

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    router.refresh();
  }

  return (
    <fieldset className={cn("inline-flex w-fit gap-1 rounded-md border p-1", onDark ? "border-white/20" : "border-line bg-surface", className)}>
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          title={label}
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            onDark ? "text-ink-on-dark hover:text-white has-[:checked]:bg-white/15 has-[:checked]:text-white" : "text-ink-muted hover:text-ink has-[:checked]:bg-raised has-[:checked]:text-ink",
          )}
        >
          <input type="radio" name={name} value={value} checked={theme === value} onChange={() => choose(value)} className="sr-only" />
          <Icon aria-hidden className="size-4" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
