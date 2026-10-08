import Link from "next/link";
import { cn } from "@/lib/cn";

/** Links between the logistics pages. */
const LINKS = [
  { href: "/admin/logistics", label: "Shipments" },
  { href: "/admin/logistics/estimates", label: "Freight estimates" },
  { href: "/admin/logistics/duty", label: "Duty and levies" },
  { href: "/admin/logistics/import", label: "Load past shipments" },
  { href: "/admin/logistics/rules", label: "Rules" },
];

export function LogisticsNav({ current }: { current: string }) {
  return (
    <nav aria-label="Logistics" className="mb-6 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined} className={cn("rounded-md border px-3 py-2 text-callout font-semibold", l.href === current ? "border-brand bg-surface" : "border-line bg-raised hover:border-brand")}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
