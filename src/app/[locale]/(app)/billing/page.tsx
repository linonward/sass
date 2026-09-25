import { getFormatter, getTranslations } from "next-intl/server";

import { getSession } from "@/core/auth/session";
import { getBillingOverview } from "@/core/billing/overview";
import { creditsEnabled, getBalance, listTransactions } from "@/core/credits";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { buildMetadata } from "@/core/seo/metadata";
import { buttonVariants } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/billing">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing.page" });
  return buildMetadata({
    locale,
    path: "/billing",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/** 账单页：当前套餐、一次性购买、积分余额和最近 20 条流水。发票等由服务商的客户门户提供。 */
export default async function BillingPage({
  params,
}: PageProps<"/[locale]/billing">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing.page" });
  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const format = await getFormatter({ locale });
  // (app) 的 layout 已确保已登录。
  const userId = (await getSession())!.user.id;
  const { subscription, purchasedPlanIds, hasCustomer } =
    await getBillingOverview({ db: getDb(), userId });
  const [balance, transactions] = creditsEnabled
    ? await Promise.all([
        getBalance(userId),
        listTransactions(userId, { limit: 20 }),
      ])
    : [0, []];

  const planName = (id: string | null) =>
    id ? tp(`plans.${id}.name` as "plans.free.name") : "";
  const date = (value: Date) => format.dateTime(value, { dateStyle: "long" });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("planTitle")}</CardTitle>
          <CardDescription>
            {subscription ? (
              <span data-testid="current-plan">
                {planName(subscription.planId)} ·{" "}
                {t(`status.${subscription.status}`)}
              </span>
            ) : (
              t("freePlan")
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {subscription?.currentPeriodEnd && (
            <p className="text-sm">
              {subscription.status === "canceled"
                ? t("endsOn", { date: date(subscription.currentPeriodEnd) })
                : t("renewsOn", { date: date(subscription.currentPeriodEnd) })}
            </p>
          )}
          {purchasedPlanIds.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t("purchasesTitle")}</p>
              <ul className="text-muted-foreground list-inside list-disc">
                {purchasedPlanIds.map((id) => (
                  <li key={id}>{planName(id)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {hasCustomer && (
              // 客户门户是服务端重定向，要整页跳转。
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/billing/portal" className={buttonVariants()}>
                {t("manage")}
              </a>
            )}
            {!subscription && (
              <Link
                href="/pricing"
                className={buttonVariants({
                  variant: hasCustomer ? "outline" : "default",
                })}
              >
                {t("viewPlans")}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {creditsEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>{t("creditsTitle")}</CardTitle>
            <CardDescription data-testid="credit-balance">
              {t("balance", { balance })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <h2 className="mb-3 text-sm font-medium">
              {t("transactionsTitle")}
            </h2>
            {transactions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("noTransactions")}
              </p>
            ) : (
              <ul
                className="divide-y text-sm"
                data-testid="credit-transactions"
              >
                {transactions.map((tx) => (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">
                        {t(`type.${tx.type}`)}
                      </span>
                      <span className="text-muted-foreground ml-2">
                        {format.dateTime(tx.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        tx.amount > 0
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {format.number(tx.amount, { signDisplay: "always" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
