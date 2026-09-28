import { UserPlusIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { createReferralService } from "@/core/acquisition/referrals/service";
import { requirePageSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { absoluteUrl } from "@/core/seo/urls";
import { buildMetadata } from "@/core/seo/metadata";
import { PageHeader } from "@/core/ui/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Badge } from "@/core/ui/badge";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/referrals">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Referrals" });
  return buildMetadata({
    locale,
    path: "/referrals",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/** 邀请页：专属邀请码与可复制链接、自己作为受邀人的关系、奖励记录、以及已接受的邀请记录。 */
export default async function ReferralsPage({
  params,
}: PageProps<"/[locale]/referrals">) {
  if (process.env.ACQUISITION_REFERRALS !== "true") notFound();
  const { locale } = await params;
  const [t, format, session] = await Promise.all([
    getTranslations({ locale, namespace: "Referrals" }),
    getFormatter({ locale }),
    requirePageSession(locale),
  ]);
  const userId = session.user.id;
  const service = createReferralService(getDb());
  // 邀请码在首次进入这一页时生成，之后一直复用；查询互不依赖，并行发出。
  const [code, relationship, invited, rewards, inviterRewards, debts] =
    await Promise.all([
      service.ensureCode(userId),
      service.relationshipFor(userId),
      service.listInvited(userId),
      service.listRewards(userId),
      service.listInviterRewards(userId),
      service.listDebts(userId),
    ]);

  const { CopyLink } = await import("@/core/acquisition/referrals/copy-link");

  const hasRewards =
    rewards.length > 0 || inviterRewards.length > 0 || debts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("linkTitle")}</CardTitle>
          <CardDescription>{t("linkDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CopyLink link={absoluteUrl(locale, `/invite/${code}`)} />
          <p className="text-muted-foreground text-sm">
            {t("code")}:{" "}
            <span className="font-mono" data-testid="referral-code">
              {code}
            </span>
          </p>
          {/* 奖励由站点运营者配置；没配置就不承诺任何回报。 */}
          <p className="text-muted-foreground text-sm text-pretty">
            {t("rewardsOff")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {relationship ? t("invitedByTitle") : t("notInvitedTitle")}
          </CardTitle>
          <CardDescription>
            {relationship
              ? t("invitedByDescription", {
                  status: t(`status.${relationship.status}`),
                })
              : t("notInvitedDescription")}
          </CardDescription>
        </CardHeader>
        {relationship && (
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t("acceptedAt", {
                date: format.dateTime(relationship.createdAt, {
                  dateStyle: "long",
                }),
              })}
            </p>
          </CardContent>
        )}
      </Card>

      {hasRewards && (
        <Card>
          <CardHeader>
            <CardTitle>{t("rewardsTitle")}</CardTitle>
            <CardDescription>{t("rewardsOff")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 text-sm">
              {inviterRewards.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2">
                    {t("invitedTitle")}
                  </p>
                  <ul className="divide-y">
                    {inviterRewards.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-4 py-2"
                      >
                        <Badge
                          variant={
                            r.type === "granted"
                              ? "secondary"
                              : "destructive-band"
                          }
                          flat
                        >
                          {t(
                            r.type === "granted"
                              ? "rewardsTypeGranted"
                              : "rewardsTypeRevoked",
                          )}
                        </Badge>
                        <span className="tabular-nums">
                          {t("rewardsInviterCredits", {
                            credits: r.inviterCredits,
                          })}
                        </span>
                        <span className="text-muted-foreground">
                          {format.dateTime(r.createdAt, {
                            dateStyle: "medium",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rewards.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2">
                    {t("invitedByTitle")}
                  </p>
                  <ul className="divide-y">
                    {rewards.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-4 py-2"
                      >
                        <Badge
                          variant={
                            r.type === "granted"
                              ? "secondary"
                              : "destructive-band"
                          }
                          flat
                        >
                          {t(
                            r.type === "granted"
                              ? "rewardsTypeGranted"
                              : "rewardsTypeRevoked",
                          )}
                        </Badge>
                        <span className="tabular-nums">
                          {t("rewardsInviteeCredits", {
                            credits: r.inviteeCredits,
                          })}
                        </span>
                        <span className="text-muted-foreground">
                          {format.dateTime(r.createdAt, {
                            dateStyle: "medium",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {debts.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2">{t("debtTitle")}</p>
                  <ul className="divide-y">
                    {debts.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-4 py-2"
                      >
                        <span className="text-muted-foreground">
                          {t("debtAmount", { amount: d.amount })}
                        </span>
                        <span className="text-muted-foreground">
                          {format.dateTime(d.createdAt, {
                            dateStyle: "medium",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("invitedTitle")}</CardTitle>
          <CardDescription>
            {t("invitedCount", { count: invited.total })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invited.rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<UserPlusIcon />}
              title={t("invitedEmpty")}
              description={t("invitedEmptyHint")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {/* 列表只取最近一批，说清楚这个数字和列表的关系。 */}
              {invited.total > invited.rows.length && (
                <p className="text-muted-foreground text-sm">
                  {t("invitedShown", { shown: invited.rows.length })}
                </p>
              )}
              {/* 只展示状态和时间：受邀人的身份不出现在邀请人的界面上。 */}
              <ul className="divide-y text-sm" data-testid="referral-invited">
                {invited.rows.map((row, index) => (
                  <li
                    key={`${row.createdAt.toISOString()}#${index}`}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span data-testid="referral-invited-status">
                      {t(`status.${row.status}`)}
                    </span>
                    <span className="text-muted-foreground">
                      {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
