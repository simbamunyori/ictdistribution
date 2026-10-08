import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { CodeForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/alert";
import { readEmailFlow } from "@/server/auth/flow-cookies";

export const metadata: Metadata = { title: "Enter your code" };

export default async function Code({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const flow = await readEmailFlow();
  if (!flow || flow.audience === "STAFF") redirect("/sign-in?expired=1");
  const { link } = await searchParams;
  const provider = link === "google" ? "Google" : link === "microsoft" ? "Microsoft" : null;
  return (
    <AuthShell
      title="Check your email"
      lead={
        <>
          We sent a six-digit code to <span className="font-semibold text-ink">{flow.email}</span>. It works for 10 minutes.
        </>
      }
      footer={
        <Link href="/sign-in" className="text-link underline underline-offset-4">
          Use a different email
        </Link>
      }
    >
      {provider ? (
        <Alert tone="info" className="mb-5">
          You already have an account with this email. Enter the code to link your {provider} account to it. Next time, {provider} signs you straight in.
        </Alert>
      ) : null}
      <CodeForm />
    </AuthShell>
  );
}
