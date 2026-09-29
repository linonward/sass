import { getTranslations } from "next-intl/server";

import { safeCallbackURL } from "@/core/auth/callback-url";
import { googleClientId } from "@/core/auth/env";
import { AFTER_SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { SignInForm } from "@/core/auth/sign-in-form";
import { redirect } from "@/core/i18n/navigation";
import { ONBOARDING_PATH } from "@/core/onboarding/landing";
import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";

import siteConfig from "../../../../../site.config";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth.signIn" });
  return buildMetadata({
    locale,
    path: "/sign-in",
    title: t("metaTitle"),
    noIndex: true,
  });
}

export default async function SignInPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  const { callbackURL } = await searchParams;
  const target = safeCallbackURL(
    typeof callbackURL === "string" ? callbackURL : undefined,
    localizedPath(locale, AFTER_SIGN_IN_PATH),
  );
  // Sign-ins with a callbackURL always go to the target page first (returns from protected pages,
  // referral links); only a direct sign-in from this page lands on onboarding when the user hasn't
  // finished the checklist.
  const onboardingPath =
    typeof callbackURL === "string" && callbackURL !== ""
      ? null
      : localizedPath(locale, ONBOARDING_PATH);

  // Already signed in: go straight to the target page.
  if (await getSession()) redirect({ href: target, locale });

  const t = await getTranslations({ locale, namespace: "Auth.signIn" });
  const { emailOtp } = siteConfig.auth;

  return (
    <div className="panel w-full max-w-sm p-6">
      <h1 className="heading-display text-2xl">
        {t("title", { name: siteConfig.name })}
      </h1>
      <p className="text-muted-foreground mt-2 mb-6 text-sm">{t("subtitle")}</p>
      <SignInForm
        callbackURL={target}
        onboardingPath={onboardingPath}
        // The client ID is public; null when Google sign-in is off (no local credentials, Vercel previews).
        googleClientId={googleClientId(process.env) ?? null}
        otp={{
          length: emailOtp.length,
          expiresIn: emailOtp.expiresIn,
          resendCooldown: emailOtp.resendCooldown,
        }}
      />
    </div>
  );
}
