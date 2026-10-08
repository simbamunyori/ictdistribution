/* eslint-disable @next/next/no-img-element */
import { company } from "@/config/app";
import { cn } from "@/lib/cn";

/**
 * The brand pack's own files (brand/BRAND.md): the lockup from 640 px up,
 * the mark alone on phones. Each colour scheme gets its own version
 * (switched with the dark variant, so the theme toggle applies too), so
 * the tile never disappears on a dark background.
 */
export function Logo({ className, lockupOnly = false }: { className?: string; lockupOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img src="/brand/logo/ictd-logo.svg" alt={company.name} width={173} height={40} className={cn("h-10 w-auto", lockupOnly ? "block dark:hidden" : "hidden sm:block sm:dark:hidden")} />
      <img src="/brand/logo/ictd-logo-reverse.svg" alt={company.name} width={173} height={40} className={cn("hidden h-10 w-auto", lockupOnly ? "dark:block" : "sm:dark:block")} />
      {lockupOnly ? null : (
        <>
          <img src="/brand/logo/ictd-mark.svg" alt={company.name} width={40} height={40} className="size-10 sm:hidden dark:hidden" />
          <img src="/brand/logo/ictd-mark-light.svg" alt={company.name} width={40} height={40} className="hidden size-10 dark:block sm:dark:hidden" />
        </>
      )}
    </span>
  );
}
