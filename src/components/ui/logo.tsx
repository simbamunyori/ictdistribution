/* eslint-disable @next/next/no-img-element */
import { company } from "@/config/app";
import { cn } from "@/lib/cn";

/**
 * The brand pack's own lockup files (brand/BRAND.md), never redrawn: Ink on
 * light backgrounds, white on dark. On an Ink panel (`onDark`) it is always
 * the white one; otherwise it follows the theme, the toggle included.
 */
export function Logo({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const size = "h-8 w-auto sm:h-9";
  if (onDark) return <img src="/brand/logo/ictdistribution-lockup-white.svg" alt={company.name} width={579} height={104} className={cn(size, className)} />;
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img src="/brand/logo/ictdistribution-lockup-ink.svg" alt={company.name} width={579} height={104} className={cn(size, "block dark:hidden")} />
      <img src="/brand/logo/ictdistribution-lockup-white.svg" alt={company.name} width={579} height={104} className={cn(size, "hidden dark:block")} />
    </span>
  );
}
