import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { staffResendCodeAction, staffVerifyCodeAction } from "@/app/admin/(auth)/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { CodeForm } from "@/components/auth/forms";
import { readEmailFlow } from "@/server/auth/flow-cookies";

export const metadata: Metadata = { title: "Enter your code", robots: { index: false } };

export default async function StaffCode() {
  const flow = await readEmailFlow();
  if (flow?.audience !== "STAFF") redirect("/admin/sign-in?expired=1");
  return (
    <AuthShell
      title="Check your email"
      lead={
        <>
          If <span className="font-semibold text-ink">{flow.email}</span> has a staff account, a six-digit code is on its way. It works for 10 minutes.
        </>
      }
      footer={
        <Link href="/admin/sign-in" className="text-link underline underline-offset-4">
          Use a different email
        </Link>
      }
    >
      <CodeForm verify={staffVerifyCodeAction} resend={staffResendCodeAction} />
    </AuthShell>
  );
}
