"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { authClient } from "@/core/auth/client";
import { authErrorMessage, type AuthError } from "@/core/auth/errors";
import { Button, buttonVariants } from "@/core/ui/button";
import { ConfirmActionDialog } from "@/core/ui/confirm-action-dialog";
import { FormField } from "@/core/ui/form-field";
import { FormMessage } from "@/core/ui/form-message";
import { Input } from "@/core/ui/input";
import { SubmitButton } from "@/core/ui/submit-button";

import { signOutDevice, signOutOtherDevices } from "./actions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "email" | "current" | "new" | "done";

/**
 * Change the account email, entirely through Better Auth's email OTP endpoints (called from the
 * browser, like the sign-in page, so they keep HTTP rate limiting and the CSRF origin check):
 *
 * 1. With `verifyCurrentEmail`, a code goes to the current address first, and
 *    `request-email-change` only accepts the new address together with that code. Without it,
 *    `request-email-change` is called with just the new address.
 * 2. A code goes to the new address; `change-email` with it makes the switch.
 * 3. The server then revokes every session of the user, this one included, so the form ends by
 *    sending the user to sign in with the new address.
 *
 * Inputs are controlled and submitted through onSubmit, so a wrong code never wipes what was typed.
 * If the new address already belongs to an account, Better Auth answers success but sends nothing
 * (it doesn't reveal which addresses are taken); the hint on the code step covers that case.
 */
export function ChangeEmailForm({
  currentEmail,
  verifyCurrentEmail,
  resendCooldown,
  signInHref,
}: {
  currentEmail: string;
  verifyCurrentEmail: boolean;
  resendCooldown: number;
  signInHref: string;
}) {
  const t = useTranslations("Account.email");
  const te = useTranslations("Auth.errors");
  const [step, setStep] = useState<Step>("email");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);

  function describe(err: AuthError) {
    const message = authErrorMessage(err, { resendCooldown });
    return "values" in message
      ? te(message.key, message.values)
      : te(message.key);
  }

  /** Run one call; on error show it and stay on this step. */
  async function run(call: () => Promise<{ error: unknown }>) {
    setError(undefined);
    setNotice(undefined);
    setPending(true);
    const { error: err } = await call();
    setPending(false);
    if (err) setError(describe(err as AuthError));
    return !err;
  }

  const sendCurrentCode = () =>
    run(() =>
      authClient.emailOtp.sendVerificationOtp({
        email: currentEmail,
        type: "email-verification",
      }),
    );

  const requestChange = (otp?: string) =>
    run(() =>
      authClient.emailOtp.requestEmailChange({
        newEmail,
        ...(otp ? { otp } : {}),
      }),
    );

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = newEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) return setError(te("invalidEmail"));
    if (address === currentEmail.toLowerCase()) return setError(t("same"));
    setNewEmail(address);
    const sent = verifyCurrentEmail
      ? await sendCurrentCode()
      : await run(() =>
          authClient.emailOtp.requestEmailChange({ newEmail: address }),
        );
    if (!sent) return;
    setCode("");
    setStep(verifyCurrentEmail ? "current" : "new");
  }

  async function submitCurrentCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await requestChange(code.trim()))) return;
    setCode("");
    setStep("new");
  }

  async function submitNewCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(() =>
      authClient.emailOtp.changeEmail({ newEmail, otp: code.trim() }),
    );
    if (ok) setStep("done");
  }

  async function resend() {
    // With verifyCurrentEmail, the current-address code was used up by request-email-change, so a
    // new code for the new address means starting again from the current address.
    const fromCurrent = step === "current" || verifyCurrentEmail;
    const sent = fromCurrent ? await sendCurrentCode() : await requestChange();
    if (!sent) return;
    setCode("");
    if (fromCurrent) setStep("current");
    setNotice(t("resent"));
  }

  function startOver() {
    setStep("email");
    setCode("");
    setError(undefined);
    setNotice(undefined);
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormMessage success={t("done", { email: newEmail })} />
        {/* A full page load: every session is gone, including this one. */}
        <a href={signInHref} className={buttonVariants()}>
          {t("signIn")}
        </a>
      </div>
    );
  }

  if (step === "email") {
    return (
      <form
        onSubmit={submitEmail}
        aria-label={t("title")}
        className="flex flex-col gap-3"
      >
        <FormField
          label={t("newLabel")}
          description={
            verifyCurrentEmail ? t("hintVerifyCurrent") : t("hintNewOnly")
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              name="newEmail"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className="sm:max-w-sm"
            />
            <SubmitButton pending={pending} pendingLabel={t("sending")}>
              {t("continue")}
            </SubmitButton>
          </div>
        </FormField>
        <FormMessage error={error} />
      </form>
    );
  }

  const toCurrent = step === "current";
  return (
    <form
      onSubmit={toCurrent ? submitCurrentCode : submitNewCode}
      aria-label={t("title")}
      className="flex flex-col gap-3"
    >
      <FormField
        label={toCurrent ? t("currentCodeLabel") : t("newCodeLabel")}
        description={
          toCurrent
            ? t("currentCodeHint", { email: currentEmail })
            : t("newCodeHint", { email: newEmail })
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="sm:max-w-40"
          />
          <SubmitButton pending={pending} pendingLabel={t("verifying")}>
            {toCurrent ? t("continue") : t("confirm")}
          </SubmitButton>
        </div>
      </FormField>
      <FormMessage error={error} success={notice} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={resend}
        >
          {t("resend")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={startOver}
        >
          {t("startOver")}
        </Button>
      </div>
    </form>
  );
}

/** Sign out one other device; the list refreshes on success. */
export function SignOutDeviceButton({
  sessionId,
  label,
}: {
  sessionId: string;
  /** The device's name, for the button's accessible name. */
  label: string;
}) {
  const t = useTranslations("Account.devices");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await signOutDevice(locale, form);
      if (result.status === "error") {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <SubmitButton
        variant="outline"
        size="sm"
        pending={pending}
        pendingLabel={t("signingOut")}
        aria-label={t("signOutDevice", { device: label })}
      >
        {t("signOut")}
      </SubmitButton>
      <FormMessage error={error} />
    </form>
  );
}

/** Sign out every device but this one, after a confirmation. */
export function SignOutOthersDialog() {
  const t = useTranslations("Account.devices");
  const locale = useLocale();
  const router = useRouter();
  return (
    <ConfirmActionDialog
      trigger={<Button variant="outline">{t("signOutOthers")}</Button>}
      title={t("othersTitle")}
      description={t("othersDescription")}
      confirmLabel={t("othersConfirm")}
      pendingLabel={t("signingOut")}
      cancelLabel={t("cancel")}
      action={() => signOutOtherDevices(locale)}
      errorMessage={(error) => t(`errors.${error}`)}
      onSuccess={() => router.refresh()}
    />
  );
}
