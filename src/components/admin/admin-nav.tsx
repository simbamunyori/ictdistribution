"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface AdminNavItem {
  href: string;
  label: string;
  /** A count to draw attention to, e.g. rates waiting to be accepted. Its hidden label stays inside the link (relative), so it never widens the page. */
  badge?: number;
}

/** Tabs across the top on a phone, a column beside the page from 1024 px. */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const path = usePathname();
  const current = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Admin" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={current(i.href) ? "page" : undefined}
              className={cn(
                "relative flex items-center justify-between gap-2 rounded-md px-3 py-2 font-semibold whitespace-nowrap text-ink-muted hover:bg-surface hover:text-ink",
                current(i.href) && "bg-surface text-ink",
              )}
            >
              {i.label}
              {i.badge ? (
                <span className="rounded-full bg-highlight px-2 text-caption font-bold text-on-highlight">
                  {i.badge}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
