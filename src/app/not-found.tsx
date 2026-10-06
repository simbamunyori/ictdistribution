import Link from "next/link";
import { SiteFrame } from "@/components/site/site-frame";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <SiteFrame>
      <div className="mx-auto max-w-xl px-4 py-20 text-center md:px-6">
        <p className="kicker text-link">Page not found</p>
        <h1 className="mt-3 text-display font-extrabold">That page isn&apos;t here</h1>
        <p className="mt-4 text-ink-body">The link may be old, or the address mistyped.</p>
        <Link href="/" className={buttonClass("primary", "lg", "mt-8")}>
          Go to the home page
        </Link>
      </div>
    </SiteFrame>
  );
}
