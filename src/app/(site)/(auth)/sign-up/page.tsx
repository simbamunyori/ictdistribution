import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, OrRule } from "@/components/auth/auth-shell";
import { EmailForm, SignUpForm } from "@/components/auth/forms";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { countryName } from "@/lib/countries";
import { currentSession } from "@/server/auth/next";
import { readPending } from "@/server/auth/flow-cookies";
import { enabledProviders } from "@/server/auth/sign-in-options";
import { prisma } from "@/server/db";
import { currentMarket } from "@/server/markets/current";
import { ORGANISATION_TYPES, listCustomerTypes } from "@/server/pricing/customer-types";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUp({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const business = q.for === "business";
  const session = await currentSession("CUSTOMER");
  if (session?.stage === "ACTIVE") redirect(business ? "/account?add=business" : "/account");
  const pending = await readPending();

  if (pending?.intent !== "sign-up") {
    return (
      <AuthShell
        title={business ? "Register your business" : "Create an account"}
        lead={business ? "Start with your work email. Next you'll add your organisation's details." : "Start with your email. No password needed."}
        footer={
          <>
            Already have an account? <Link href="/sign-in" className="text-link underline underline-offset-4">Sign in</Link>
          </>
        }
      >
        <ProviderButtons providers={enabledProviders("CUSTOMER")} next={business ? "/sign-up?for=business" : undefined} />
        {enabledProviders("CUSTOMER").length ? <OrRule /> : null}
        <EmailForm label="Continue" next={business ? "/sign-up?for=business" : undefined} />
      </AuthShell>
    );
  }

  const [{ market, markets }, types] = await Promise.all([currentMarket(), listCustomerTypes(prisma)]);
  return (
    <AuthShell title={business ? "Your business details" : "Nearly done"} lead="Tell us who you are and where you buy from.">
      <SignUpForm
        email={pending.email}
        name={pending.name}
        business={business}
        countries={markets.map((m) => ({ value: m.country, label: countryName(m.country) }))}
        defaultCountry={market.country}
        organisationTypes={types.filter((t) => ORGANISATION_TYPES.includes(t.code)).map((t) => ({ value: t.code, label: t.name, description: t.description }))}
      />
    </AuthShell>
  );
}
