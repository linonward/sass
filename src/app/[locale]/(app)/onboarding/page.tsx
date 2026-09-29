import { getTranslations } from "next-intl/server";

import { AFTER_SIGN_IN_PATH } from "@/core/auth/routes";
import { requirePageSession } from "@/core/auth/session";
import { placeholderIssues } from "@/core/config/sentinels";
import { OnboardingChecklist } from "@/core/onboarding/checklist";
import { ONBOARDING_PATH } from "@/core/onboarding/landing";
import { onboardingSteps } from "@/core/onboarding/steps";
import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";
import { PageHeader } from "@/core/ui/page-header";

import siteConfig from "../../../../../site.config";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding" });
  return buildMetadata({
    locale,
    path: ONBOARDING_PATH,
    title: t("metaTitle"),
    noIndex: true,
  });
}

/**
 * First-run checklist: new sign-ups land here automatically (see src/core/onboarding/landing.ts),
 * and it stays reachable from the sidebar. Each step's done/not-done state is computed on the fly
 * from the factory sentinels in site.config.ts and the product IDs in the plans — nothing is stored.
 */
export default async function OnboardingPage({ params }: Props) {
  const { locale } = await params;
  const [t, session] = await Promise.all([
    getTranslations({ locale, namespace: "Onboarding" }),
    requirePageSession(locale),
  ]);

  const steps = onboardingSteps({
    brandColor: siteConfig.brand.primaryColor,
    placeholders: placeholderIssues(siteConfig),
    planProductIds: siteConfig.billing.plans.flatMap((plan) =>
      plan.providerProductId ? [plan.providerProductId] : [],
    ),
    blogEnabled: siteConfig.features.blog,
    onVercel: Boolean(process.env.VERCEL),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <OnboardingChecklist
        locale={locale}
        steps={steps}
        donePath={localizedPath(locale, AFTER_SIGN_IN_PATH)}
        completed={session.user.onboardingCompleted === true}
      />
    </div>
  );
}
