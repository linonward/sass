import { getFormatter, getTranslations } from "next-intl/server";

import { requirePageSession } from "@/core/auth/session";
import { getBillingOverview, planSummary } from "@/core/billing/overview";
import { listedPlans } from "@/core/billing/plans";
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
import { PageHeader } from "@/core/ui/page-header";

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

/**
 * Billing page: current plan, one-time purchases, credit balance and the 20 most recent credit
 * transactions. Invoices and the like come from the provider's customer portal.
 */
export default async function BillingPage({
  params,
}: PageProps<"/[locale]/billing">) {
  const { locale } = await params;
  // Messages, formatters and the session check don't depend on each other, so fire them
  // concurrently; the session's userId isn't needed until the next block.
  const [t, tp, format, session] = await Promise.all([
    getTranslations({ locale, namespace: "Billing.page" }),
    getTranslations({ locale, namespace: "Landing.pricing" }),
    getFormatter({ locale }),
    requirePageSession(locale),
  ]);
  const userId = session.user.id;
  // Billing state, balance and credit transactions are independent; query them in parallel.
  const [
    { subscription, purchasedPlanIds, hasCustomer },
    balance,
    transactions,
  ] = await Promise.all([
    getBillingOverview({ db: getDb(), userId }),
    creditsEnabled ? getBalance(userId) : 0,
    creditsEnabled ? listTransactions(userId, { limit: 20 }) : [],
  ]);

  const summary = planSummary(
    { subscription, purchasedPlanIds },
    listedPlans(),
  );
  const planName = (id: string | null) =>
    id ? tp(`plans.${id}.name` as "plans.free.name") : "";
  const date = (value: Date) => format.dateTime(value, { dateStyle: "long" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("planTitle")}</CardTitle>
          <CardDescription>
            {subscription ? (
              <span data-testid="current-plan">
                {planName(subscription.planId)} ·{" "}
                {t(`status.${subscription.status}`)}
              </span>
            ) : summary === "purchased" ? (
              t("purchasedOnly")
            ) : summary === "free" ? (
              t("freePlan")
            ) : (
              t("noPlan")
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
              // The customer portal is a server-side redirect, so it needs a full-page navigation.
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
                className="divide-y text-sm [&>li:first-child]:pt-0 [&>li:last-child]:pb-0"
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
                        // Credits in get the semantic color; deductions stay neutral: spending credits is normal, and red
                        // would be too loud.
                        tx.amount > 0
                          ? "text-success"
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
