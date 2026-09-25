import { getTranslations } from "next-intl/server";

import { CheckoutStatus } from "@/core/billing/ui/checkout-status";
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
  const t = await getTranslations({ locale, namespace: "Billing.success" });

  if (!subscriptionId && !orderId) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("missingTitle")}
        </h1>
        <p className="text-muted-foreground">
          {t.rich("missingDescription", {
            email: siteConfig.legal.contactEmail,
            link: (chunks) => (
              <a
                href={`mailto:${siteConfig.legal.contactEmail}`}
                className="text-primary underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
    );
  }

  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const planNames = Object.fromEntries(
    siteConfig.billing.plans.map((p) => [
      p.id,
      tp(`plans.${p.id}.name` as "plans.free.name"),
    ]),
  );

  return (
    <CheckoutStatus
      reference={{ subscriptionId, orderId }}
      timeoutMs={env.BILLING_SUCCESS_TIMEOUT_MS}
      supportEmail={siteConfig.legal.contactEmail}
      planNames={planNames}
    />
  );
}
