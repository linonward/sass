import { getTranslations } from "next-intl/server";

import { safeCallbackURL } from "@/core/auth/callback-url";
import { googleCredentials } from "@/core/auth/env";
import { AFTER_SIGN_IN_PATH } from "@/core/auth/routes";
import { getSession } from "@/core/auth/session";
import { SignInForm } from "@/core/auth/sign-in-form";
import { redirect } from "@/core/i18n/navigation";
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

  // 已登录时直接进入目标页面。
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
        googleEnabled={Boolean(googleCredentials(process.env))}
        otp={{
          length: emailOtp.length,
          expiresIn: emailOtp.expiresIn,
          resendCooldown: emailOtp.resendCooldown,
        }}
      />
    </div>
  );
}
