import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  isReferralCode,
  normalizeReferralCode,
} from "@/core/acquisition/referrals/code";
import { createReferralService } from "@/core/acquisition/referrals/service";
import { referralFromHeaders } from "@/core/acquisition/tokens";
import { getSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { env } from "@/core/env";
import { Link } from "@/core/i18n/navigation";
import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";
import { buttonVariants } from "@/core/ui/button";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/invite/[code]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Referrals.invite" });
  return buildMetadata({
    locale,
    path: null,
    title: t("metaTitle"),
    description: t("description"),
    // 邀请链接是个人的，不进搜索索引。
    noIndex: true,
  });
}

type View =
  "offer" | "accepted" | "other" | "self" | "bound" | "signedIn" | "invalid";

/**
 * 邀请落地页：注册前展示邀请提示、条件与归属说明，接受与否由访客自己决定。
 * 这里只读邀请上下文，任何写入都走 `/api/acquisition/referrals`。
 */
export default async function InvitePage({
  params,
}: PageProps<"/[locale]/invite/[code]">) {
  if (process.env.ACQUISITION_REFERRALS !== "true") notFound();
  const [{ locale, code: raw }, t] = await Promise.all([
    params,
    getTranslations("Referrals.invite"),
  ]);
  const code = normalizeReferralCode(raw);
  const service = createReferralService(getDb());
  // 码无效、邀请人不存在或被封禁时都按同一种「链接无效」处理，不区分原因。
  const inviter = isReferralCode(code)
    ? await service.resolveInviter(code)
    : null;
  const [session, accepted] = await Promise.all([
    getSession(),
    referralFromHeaders(await headers(), env.BETTER_AUTH_SECRET),
  ]);

  let view: View = "invalid";
  if (inviter) {
    if (session) {
      if (session.user.id === inviter.userId) view = "self";
      else if (await service.relationshipFor(session.user.id)) view = "bound";
      else view = "signedIn";
    } else if (accepted?.code === code) view = "accepted";
    else if (accepted) view = "other";
    else view = "offer";
  }

  const { InviteActions } =
    await import("@/core/acquisition/referrals/invite-actions");
  const title =
    view === "invalid"
      ? t("invalidTitle")
      : view === "self"
        ? t("selfTitle")
        : view === "bound"
          ? t("boundTitle")
          : view === "signedIn"
            ? t("signedInTitle")
            : view === "other"
              ? t("otherTitle")
              : view === "accepted"
                ? t("acceptedTitle")
                : inviter?.name.trim()
                  ? t("fromTitle", { name: inviter.name })
                  : t("genericTitle");
  const body =
    view === "invalid"
      ? t("invalidBody")
      : view === "self"
        ? t("selfBody")
        : view === "bound"
          ? t("boundBody")
          : view === "signedIn"
            ? t("signedInBody")
            : view === "other"
              ? t("otherBody")
              : view === "accepted"
                ? t("acceptedBody")
                : t("body");

  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:py-20">
      <section
        aria-label={t("metaTitle")}
        className="sticker bg-card rounded-xl p-6 sm:p-8"
      >
        <h1 className="heading-display text-2xl" data-testid="invite-title">
          {title}
        </h1>
        <p className="text-muted-foreground mt-3 text-pretty">{body}</p>

        {view === "offer" && (
          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-medium">{t("termsTitle")}</h2>
            <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
              {/* 没有配置奖励就明说不承诺奖励。 */}
              <li>{t("rewardsOff")}</li>
              <li>{t("termsVoluntary")}</li>
              <li>{t("termsIdentity")}</li>
            </ul>
          </div>
        )}

        {(view === "offer" || view === "accepted" || view === "other") && (
          <div className="mt-6">
            <InviteActions
              code={code}
              mode={
                view === "offer"
                  ? "offer"
                  : view === "accepted"
                    ? "accepted"
                    : "clear"
              }
            />
          </div>
        )}

        {view === "accepted" && (
          <div className="mt-6">
            <Link
              href={`/sign-in?callbackURL=${encodeURIComponent(
                localizedPath(locale, "/referrals"),
              )}`}
              className={buttonVariants({ size: "marketing" })}
            >
              {t("acceptedCta")}
            </Link>
          </div>
        )}

        {view === "invalid" && (
          <div className="mt-6">
            <Link
              href="/"
              className={buttonVariants({
                variant: "outline",
                size: "marketing",
              })}
            >
              {t("back")}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
