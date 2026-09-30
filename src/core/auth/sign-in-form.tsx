"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { Link } from "@/core/i18n/navigation";
import { legalPages } from "@/core/legal/pages";
import { resolvePostSignInPath } from "@/core/onboarding/landing";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import { authClient } from "./client";
import { authErrorMessage, RESEND_COOLDOWN, type AuthError } from "./errors";
import { signInWithOneTap } from "./one-tap";

type OtpSettings = {
  length: number;
  expiresIn: number;
  resendCooldown: number;
};

type Props = {
  /** Same-site URL to go to after a successful sign-in (already sanitized, with locale prefix). */
  callbackURL: string;
  /**
   * First-run onboarding URL (with locale prefix). null when this sign-in carries a callbackURL
   * parameter: the deep link wins and there's no onboarding (rules in
   * src/core/onboarding/landing.ts).
   */
  onboardingPath: string | null;
  /**
   * Google client ID (a public value); null means Google sign-in is disabled (no credentials
   * locally, or a Vercel preview).
   */
  googleClientId: string | null;
  otp: OtpSettings;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Hydrated" has no external event source — hydration is React's own one-time switch, so the
// subscribe function just returns a no-op unsubscribe.
const subscribeHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function SignInForm({
  callbackURL,
  onboardingPath,
  googleClientId,
  otp,
}: Props) {
  const t = useTranslations("Auth.signIn");
  const te = useTranslations("Auth.errors");
  // Having a client ID means Google sign-in is enabled: the button and the One Tap prompt share one
  // source rather than each checking separately.
  const googleEnabled = googleClientId !== null;

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Before hydration, onSubmit isn't attached yet, so a submit goes through the browser's native
  // form GET: the whole URL becomes `/sign-in?email=…` and callbackURL is lost, so users coming
  // from a protected page or a referral link land on onboarding after sign-in instead of their
  // original target (only on slow networks and mobile, but reliably reproducible in local dev).
  // Disabling the submit button blocks both paths — clicking and pressing Enter (the form's
  // implicit submission) — and it becomes usable again once hydrated.
  // Same approach as src/core/hooks/use-mobile.ts: the server snapshot is false and the client
  // snapshot is true, so SSR and the first frame match without a mismatch, and there's no need to
  // setState synchronously in an effect (which eslint's set-state-in-effect rule would block).
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    hydratedSnapshot,
    serverSnapshot,
  );

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  // Countdown: refresh every second during the cooldown and stop at 0.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  // Google One Tap: show the account prompt as soon as the page loads; one click on the avatar
  // completes sign-in. Guarded with a ref because StrictMode runs effects twice, and the plugin's
  // own concurrency guard only does a console.warn.
  const prompted = useRef(false);
  useEffect(() => {
    if (!googleClientId || prompted.current) return;
    prompted.current = true;
    void signInWithOneTap({
      clientId: googleClientId,
      callbackURL,
      // Only reached when the user clicked the prompt but the callback failed; a script that
      // failed to load doesn't bother the user (see one-tap.ts).
      onError: () => setError(te("googleFailed")),
    });
  }, [googleClientId, callbackURL, te]);

  function startCooldown(seconds: number) {
    const start = Date.now();
    setNow(start);
    setCooldownUntil(start + seconds * 1000);
  }

  function describe(err: AuthError): string {
    const message = authErrorMessage(err, {
      resendCooldown: otp.resendCooldown,
      googleEnabled,
    });
    return "values" in message
      ? te(message.key, message.values)
      : te(message.key);
  }

  async function sendCode(address = email) {
    setError(null);
    setPending(true);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: "sign-in",
    });
    setPending(false);

    if (err) {
      const authError = err as AuthError;
      if (authError.code === RESEND_COOLDOWN) {
        // Just sent one: go straight to the code entry step and count down from the server's
        // remaining time.
        setStep("code");
        startCooldown(authError.retryAfter ?? otp.resendCooldown);
      }
      setError(describe(authError));
      return;
    }
    setStep("code");
    setCode("");
    startCooldown(otp.resendCooldown);
  }

  async function onSubmitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setError(te("invalidEmail"));
      return;
    }
    setEmail(address);
    await sendCode(address);
  }

  async function verify(value: string) {
    setError(null);
    setPending(true);
    const { data, error: err } = await authClient.signIn.emailOtp({
      email,
      otp: value,
    });
    if (err) {
      setPending(false);
      setCode("");
      setError(describe(err as AuthError));
      return;
    }
    // Full-page navigation so server components read the new session cookie. Where to go depends
    // on the returned user record: in a sign-in without a callbackURL, users who haven't finished
    // first-run onboarding go to onboarding first.
    window.location.assign(
      resolvePostSignInPath({ callbackURL, onboardingPath, user: data?.user }),
    );
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, otp.length);
    setCode(digits);
    if (digits.length === otp.length && !pending) void verify(digits);
  }

  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    const { error: err } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
      // The Google path is a full-page round trip the client can't intervene in: new sign-ups can
      // only be sent to onboarding through the server's callback target. Existing accounts that
      // haven't finished the checklist aren't sent there — the server can't tell whether they're
      // done.
      ...(onboardingPath ? { newUserCallbackURL: onboardingPath } : {}),
    });
    if (err) {
      setPending(false);
      setError(describe(err as AuthError));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={signInWithGoogle}
          >
            <GoogleIcon />
            {t("google")}
          </Button>
          <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
            <span className="bg-border h-px flex-1" />
            {t("or")}
            <span className="bg-border h-px flex-1" />
          </div>
        </>
      )}

      {step === "email" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={onSubmitEmail}
          noValidate
        >
          <Label htmlFor="sign-in-email">{t("emailLabel")}</Label>
          <Input
            id="sign-in-email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={error ? true : undefined}
            className="h-10"
            required
            autoFocus
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!hydrated || pending}
          >
            {pending ? t("sending") : t("sendCode")}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === otp.length) void verify(code);
          }}
        >
          <p className="text-muted-foreground text-sm">
            {t("codeSent", {
              length: otp.length,
              email,
              minutes: Math.round(otp.expiresIn / 60),
            })}
          </p>
          <Label htmlFor="sign-in-code">{t("codeLabel")}</Label>
          <Input
            id="sign-in-code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={otp.length}
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            className="h-12 text-center font-mono text-2xl tracking-[0.5em] md:text-2xl"
            autoFocus
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!hydrated || pending || code.length !== otp.length}
          >
            {pending ? t("verifying") : t("verify")}
          </Button>
          <div className="flex items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              {t("changeEmail")}
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 tabular-nums"
              disabled={pending || secondsLeft > 0}
              onClick={() => sendCode()}
            >
              {secondsLeft > 0
                ? t("resendIn", { seconds: secondsLeft })
                : t("resend")}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p
          role="alert"
          data-testid="auth-error"
          className="text-destructive text-sm"
        >
          {error}
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {t.rich("legal", {
          terms: (chunks) => (
            <Link
              href={legalPages.terms}
              className="underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link
              href={legalPages.privacy}
              className="underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
