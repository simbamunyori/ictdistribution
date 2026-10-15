import { Building2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { shopper } from "@/server/shop/viewer";

/**
 * "Buying for a business?" with the way to register, or, for a business
 * we haven't approved yet, the way to finish. Approved businesses see nothing.
 */
export async function BusinessPrompt({ className }: { className?: string }) {
  const { standing, organisation } = await shopper();
  if (standing === "trade") return null;
  return (
    <p className={cn("flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-callout", className)}>
      <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-link" />
      {standing === "unverified" ? (
        <span>
          {organisation?.verification === "PENDING" ? "We are checking your business. Trade prices show once we approve it." : "You see trade prices once we have checked your business."}{" "}
          <Link href="/account/business" className="font-semibold text-link underline underline-offset-4">
            {organisation?.verification === "PENDING" ? "See where it is" : "Send your company details"}
          </Link>
        </span>
      ) : (
        <span>
          Buying for a business?{" "}
          <Link href="/sign-up?for=business" className="font-semibold text-link underline underline-offset-4">
            Register for trade prices
          </Link>
          , quotes and credit terms.
        </span>
      )}
    </p>
  );
}
