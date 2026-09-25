import { getTranslations } from "next-intl/server";

import { getSession } from "@/core/auth/session";
import { getBillingOverview, ownedPlans } from "@/core/billing/overview";
import { getPlan } from "@/core/billing/plans";
import { AutoCheckout } from "@/core/billing/ui/auto-checkout";
import { getDb } from "@/core/db";
import { Pricing } from "@/core/marketing/sections/pricing";
import { buildMetadata } from "@/core/seo/metadata";

import siteConfig from "../../../../../site.config";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing.pricing" });
  return buildMetadata({
    locale,
    path: "/pricing",
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

/**
 * 定价页。和落地页共用 Pricing 区块，但会按登录用户显示已订阅、已购买的状态；
 * 未登录用户点购买时先登录，登录后带着 ?plan=<id> 回到这里自动继续结账。
 */
export default async function PricingPage({
  searchParams,
}: PageProps<"/[locale]/pricing">) {
  const { plan: planParam } = await searchParams;
  const session = await getSession();
  const owned = session
    ? ownedPlans(
        await getBillingOverview({ db: getDb(), userId: session.user.id }),
      )
    : {};

  const resume =
    session && typeof planParam === "string" ? getPlan(planParam) : undefined;
  const autoCheckout = resume && resume.price > 0 && !owned[resume.id];

  return (
    <>
      {autoCheckout && (
        <div className="px-4 pt-10">
          <AutoCheckout planId={resume.id} />
        </div>
      )}
      <Pricing
        plans={siteConfig.billing.plans}
        currency={siteConfig.billing.currency}
        owned={owned}
        headingLevel={1}
      />
    </>
  );
}
