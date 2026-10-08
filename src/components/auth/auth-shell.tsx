import Link from "next/link";
import { company } from "@/config/app";
import { Logo } from "@/components/ui/logo";

/** The frame around sign-in and sign-up: the brand, one card, nothing else to distract. */
export function AuthShell({ title, lead, children, footer }: { title: string; lead?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface px-4 py-10">
      <Link href="/" aria-label={`${company.name} home`} className="rounded-md">
        <Logo lockupOnly />
      </Link>
      <main className="mt-8 w-full max-w-md rounded-lg border border-line bg-raised p-6 md:p-8">
        <h1 className="text-title font-bold">{title}</h1>
        {lead ? <div className="mt-2 text-ink-body">{lead}</div> : null}
        <div className="mt-6">{children}</div>
      </main>
      {footer ? <div className="mt-6 text-center text-callout text-ink-muted">{footer}</div> : null}
    </div>
  );
}

export function OrRule() {
  return (
    <div className="my-5 flex items-center gap-3 text-caption text-ink-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
