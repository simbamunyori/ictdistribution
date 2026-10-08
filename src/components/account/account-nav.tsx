"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(site)/actions";
import { cn } from "@/lib/cn";

/** Tabs across the top on a phone, a column beside the page from 768 px. */
export function AccountNav({ organisation }: { organisation: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/account", label: "Overview" },
    { href: "/account/orders", label: "Orders" },
    ...(organisation
      ? [
          { href: "/account/team", label: "Team" },
          { href: "/account/business", label: "Business details" },
          { href: "/account/credit", label: "Credit" },
        ]
      : []),
    { href: "/account/sign-in-methods", label: "Sign-in" },
  ];
  return (
    <nav aria-label="Your account" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={path === i.href ? "page" : undefined}
              className={cn("block rounded-md px-3 py-2 font-semibold whitespace-nowrap text-ink-muted hover:bg-surface hover:text-ink", path === i.href && "bg-surface text-ink")}
            >
              {i.label}
            </Link>
          </li>
        ))}
        <li className="md:mt-4 md:border-t md:border-line md:pt-4">
          <form action={signOutAction}>
            <button type="submit" className="block w-full rounded-md px-3 py-2 text-left font-semibold whitespace-nowrap text-ink-muted hover:bg-surface hover:text-ink">
              Sign out
            </button>
          </form>
        </li>
      </ul>
    </nav>
  );
}
