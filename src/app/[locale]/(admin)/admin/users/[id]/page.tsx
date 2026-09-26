import { randomUUID } from "node:crypto";

import { ArrowLeft } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { adminMetadata } from "@/core/admin/metadata";
import { planLabel } from "@/core/admin/plan-name";
import { getUserDetail } from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import { AdjustCreditsForm, BanForm } from "@/core/admin/ui/forms";
import { RoleBadge, UserStatusBadge } from "@/core/admin/ui/list";
import { creditsEnabled } from "@/core/credits";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { PageHeader } from "@/core/ui/page-header";

type Props = PageProps<"/[locale]/admin/users/[id]">;

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return adminMetadata(params, `/admin/users/${id}`, (t) =>
    t("user.metaTitle"),
  );
}

/** 用户详情：资料、封禁、积分调整和流水、订阅和订单。 */
export default async function AdminUserPage({ params }: Props) {
  const session = await requireAdmin();
  const { locale, id } = await params;
  const user = (await getUserDetail(getDb(), id)) ?? notFound();

  const t = await getTranslations({ locale, namespace: "Admin" });
  const tb = await getTranslations({ locale, namespace: "Billing.page" });
  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const format = await getFormatter({ locale });
  const dateTime = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });
  const planName = (planId: string | null) => planLabel(tp, planId);
  const isSelf = user.id === session.user.id;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/users"
        className="text-muted-foreground hover:text-primary-text inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("user.back")}
      </Link>
      <PageHeader
        title={user.email}
        description={user.name || t("user.noName")}
      >
        <div className="flex gap-2">
          <RoleBadge role={user.role} />
          <UserStatusBadge banned={user.banned} />
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>{t("user.profileTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("user.email")}</dt>
            <dd className="break-all">
              {user.email}{" "}
              <Badge variant="outline" className="ml-1">
                {user.emailVerified
                  ? t("user.emailVerified")
                  : t("user.emailUnverified")}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">{t("user.joined")}</dt>
            <dd>{dateTime(user.createdAt)}</dd>
            <dt className="text-muted-foreground">{t("user.id")}</dt>
            <dd className="font-mono text-xs break-all">{user.id}</dd>
          </dl>
        </CardContent>
      </Card>

      {!isSelf && (
        <Card>
          <CardHeader>
            <CardTitle>{t("user.banTitle")}</CardTitle>
            <CardDescription>
              {user.banned ? (
                <span role="status">
                  {t("user.bannedNotice")}
                  {user.banReason &&
                    ` ${t("user.bannedReason", { reason: user.banReason })}`}
                </span>
              ) : (
                t("user.banDescription")
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* 状态变化时重新挂载，清掉上一次提交的结果。 */}
            <BanForm
              key={String(user.banned)}
              userId={user.id}
              banned={Boolean(user.banned)}
            />
          </CardContent>
        </Card>
      )}

      {creditsEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>{t("user.creditsTitle")}</CardTitle>
            <CardDescription data-testid="admin-credit-balance">
              {t("user.balance", { balance: user.balance })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <AdjustCreditsForm userId={user.id} requestId={randomUUID()} />
            <div>
              <h2 className="mb-3 text-sm font-medium">
                {t("user.transactionsTitle")}
              </h2>
              {user.transactions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("user.noTransactions")}
                </p>
              ) : (
                <ul
                  className="divide-y text-sm [&>li:first-child]:pt-0 [&>li:last-child]:pb-0"
                  data-testid="admin-credit-transactions"
                >
                  {user.transactions.map((tx) => (
                    <li
                      key={tx.id}
                      className="flex items-start justify-between gap-4 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">
                          {tb(`type.${tx.type}`)}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          {dateTime(tx.createdAt)}
                        </span>
                        {tx.reason && (
                          <span className="block break-words">{tx.reason}</span>
                        )}
                        {tx.type === "adjust" && tx.actorEmail && (
                          <span className="text-muted-foreground block text-xs">
                            {t("user.by", { email: tx.actorEmail })}
                          </span>
                        )}
                        {tx.type === "adjust" &&
                          !tx.actorEmail &&
                          tx.source === "admin" && (
                            <span className="text-muted-foreground block text-xs">
                              {t("user.deletedActor")}
                            </span>
                          )}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          // 进账用语义色，扣减保持中性：花积分是常态，标红太吵。
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
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("user.subscriptionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {user.subscriptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("user.noSubscriptions")}
            </p>
          ) : (
            <ul className="divide-y text-sm [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
              {user.subscriptions.map((sub) => (
                <li
                  key={sub.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="font-medium">{planName(sub.planId)}</span>
                  <span className="text-muted-foreground">
                    {tb(`status.${sub.status}`)}
                    {sub.currentPeriodEnd &&
                      ` · ${format.dateTime(sub.currentPeriodEnd, { dateStyle: "medium" })}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("user.ordersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {user.orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("user.noOrders")}
            </p>
          ) : (
            <ul className="divide-y text-sm [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
              {user.orders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">
                      {planName(order.planId)}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      {dateTime(order.createdAt)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {order.amount !== null && order.currency
                      ? format.number(order.amount / 100, {
                          style: "currency",
                          currency: order.currency,
                        })
                      : "—"}{" "}
                    · {t(`orderStatus.${order.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
