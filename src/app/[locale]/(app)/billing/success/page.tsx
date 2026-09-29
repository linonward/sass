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
 * 结账回跳页。支付回跳不依赖 webhook 已到：页面按回跳附带的订阅或订单 ID 轮询状态，
 * webhook 未到时显示"处理中"。状态只以数据库为准，回跳参数（含签名）不作为付款成功的依据。
 */
export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: PageProps<"/[locale]/billing/success">) {
  const { locale } = await params;
  const query = await searchParams;
  const subscriptionId = param(query.subscription_id);
  const orderId = param(query.order_id);
  // 服务商回跳不带 ID 时的兜底：结账时站内加的套餐 + 下单时间（见 core/billing/checkout.ts）。
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

  // 卖可下载文件的套餐（site.config.ts 的 downloads）：成功页提示邮件已发、主按钮换成下载页。
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
