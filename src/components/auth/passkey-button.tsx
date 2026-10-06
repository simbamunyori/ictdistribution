"use client";

import type { UserKind } from "@prisma/client";
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { passkeyOptionsAction, passkeyVerifyAction } from "@/app/passkey-actions";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import type { ChallengePurpose } from "@/server/auth/flow-cookies";

const noSubscription = () => () => {};
/** Whether this browser can use passkeys; false until known, so nothing flashes. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(noSubscription, browserSupportsWebAuthn, () => false);
}

/**
 * One passkey use: sign in, the staff passkey step, setting one up,
 * adding one, or the recent check. Hidden where passkeys don't work,
 * unless `required` (staff), where it says so instead.
 */
export function PasskeyButton({
  purpose,
  audience = "CUSTOMER",
  next,
  children,
  variant = "secondary",
  size = "lg",
  className,
  required = false,
  after,
}: {
  purpose: ChallengePurpose;
  audience?: UserKind;
  next?: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  required?: boolean;
  /** Shown under the button, only where passkeys work (e.g. an "or" rule). */
  after?: React.ReactNode;
}) {
  const supported = usePasskeySupport();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!supported) return required ? <Alert tone="warning">This browser can&apos;t use passkeys. Use an up-to-date browser on a phone or computer with a fingerprint, face or PIN unlock.</Alert> : null;

  const go = () =>
    start(async () => {
      setError(undefined);
      const got = await passkeyOptionsAction(purpose, audience);
      if ("error" in got) {
        if (got.redirect) return router.push(got.redirect);
        return setError(got.error);
      }
      let response;
      try {
        response = got.kind === "register" ? await startRegistration({ optionsJSON: got.options }) : await startAuthentication({ optionsJSON: got.options });
      } catch (e) {
        const code = e instanceof WebAuthnError ? e.code : "";
        return setError(code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" ? "This device already has a passkey for your account." : "The passkey check was cancelled or timed out. Try again.");
      }
      const result = await passkeyVerifyAction(purpose, audience, response, next);
      // A new session: load the next page afresh so every part of it sees who is signed in.
      if (result.redirect) return window.location.assign(result.redirect);
      if (result.error) return setError(result.error);
      router.refresh();
    });

  return (
    <div className={className}>
      <Button variant={variant} size={size} onClick={go} disabled={pending} className="w-full">
        <Fingerprint aria-hidden />
        {pending ? "Waiting for your device" : children}
      </Button>
      {error ? <Alert className="mt-3">{error}</Alert> : null}
      {after}
    </div>
  );
}
