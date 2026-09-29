import { CircleAlertIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { CheckoutStatus } from "@/core/billing/ui/checkout-status";
import { EmptyState } from "@/core/ui/empty-state";
import { env } from "@/core/env";
import { buildMetadata } from "@/core/seo/metadata";

import siteConfig from "../../../../../../site.config";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/billing/success">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing.success" });
  return buildMetadata({
    locale,
    path: "/billing/success",
    title: t("metaTitle"),
    noIndex: true,
  });
}

const param = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/**
 * Checkout return page. It doesn't rely on the webhook having arrived: the page polls status using
 * the subscription or order ID on the return URL and shows "processing" until the webhook lands.
 * Only the database is authoritative; return-URL params (signature included) are never taken as
 * proof of payment.
 */
export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: PageProps<"/[locale]/billing/success">) {
  const { locale } = await params;
  const query = await searchParams;
  const subscriptionId = param(query.subscription_id);
  const orderId = param(query.order_id);
  // Fallback when the provider's redirect carries no ID: the plan plus order time we add at checkout
  // (see core/billing/checkout.ts).
  const planId = param(query.plan);
  const since = param(query.since);
  const t = await getTranslations({ locale, namespace: "Billing.success" });

  if (!subscriptionId && !orderId && !(planId && since)) {
    return (
      <EmptyState
        titleAs="h1"
        icon={<CircleAlertIcon />}
        title={t("missingTitle")}
        description={t.rich("missingDescription", {
          email: siteConfig.legal.contactEmail,
          link: (chunks) => (
            <a
              href={`mailto:${siteConfig.legal.contactEmail}`}
              className="text-primary-text underline underline-offset-4"
            >
              {chunks}
            </a>
          ),
        })}
      />
    );
  }

  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const planNames = Object.fromEntries(
    siteConfig.billing.plans.map((p) => [
      p.id,
      tp(`plans.${p.id}.name` as "plans.free.name"),
    ]),
  );

  // Plans that sell downloadable files (downloads in site.config.ts): the success page says the email
  // was sent and the primary button goes to the downloads page instead.
  const td = await getTranslations({ locale, namespace: "Downloads" });
  const nextSteps = siteConfig.downloads.enabled
    ? Object.fromEntries(
        siteConfig.downloads.products.map((product) => [
          product.planId,
          {
            note: td("successNote"),
            href: "/downloads",
            label: td("successCta"),
          },
        ]),
      )
    : {};

  return (
    <CheckoutStatus
      nextSteps={nextSteps}
      reference={{ subscriptionId, orderId, planId, since }}
      timeoutMs={env.BILLING_SUCCESS_TIMEOUT_MS}
      supportEmail={siteConfig.legal.contactEmail}
      planNames={planNames}
    />
  );
}
