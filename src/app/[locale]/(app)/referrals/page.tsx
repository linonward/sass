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

/**
 * Referrals page: your referral code and copyable link, who referred you (if anyone), reward history,
 * and accepted referrals.
 */
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
  // The referral code is created on the first visit to this page and reused after that; the queries
  // are independent, so fire them in parallel.
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
          {/* Rewards are configured by the site operator; with none configured, promise nothing. */}
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
              {/* The list shows only the latest batch, so spell out how this number relates to it. */}
              {invited.total > invited.rows.length && (
                <p className="text-muted-foreground text-sm">
                  {t("invitedShown", { shown: invited.rows.length })}
                </p>
              )}
              {/* Show status and time only: the referred user's identity never appears in the referrer's UI. */}
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
