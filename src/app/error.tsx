"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/** Something broke on our side. The details are in the server log, under the digest. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-20 text-center md:px-6">
      <p className="kicker text-link">Something went wrong</p>
      <h1 className="mt-3 text-display font-extrabold">That didn&apos;t work</h1>
      <p className="mt-4 text-ink-body">It&apos;s a problem on our side, and we&apos;ve logged it. Try again, or come back in a few minutes.</p>
      {error.digest ? <p className="mt-2 text-caption text-ink-muted">Reference {error.digest}</p> : null}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <button type="button" onClick={reset} className={buttonClass("primary", "lg")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary", "lg")}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
