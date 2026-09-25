import { LayoutDashboardIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/core/auth/session";
import { Link } from "@/core/i18n/navigation";
import { buildMetadata } from "@/core/seo/metadata";
import { buttonVariants } from "@/core/ui/button";

import siteConfig from "../../../../../site.config";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard.home" });
  return buildMetadata({
    locale,
    path: "/dashboard",
    title: t("metaTitle"),
    noIndex: true,
  });
}

// 空状态首页。业务项目在这里放自己的概览，或把 dashboard.nav 的第一项作为主入口。
export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard.home" });
  const session = await getSession();
  const name = session?.user.name?.trim();

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground" data-testid="signed-in-as">
          {name
            ? t("welcomeName", { name })
            : t("welcome", { email: session?.user.email ?? "" })}
        </p>
      </div>
      <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
        <span className="bg-muted flex size-12 items-center justify-center rounded-full">
          <LayoutDashboardIcon className="text-muted-foreground size-6" />
        </span>
        <div className="max-w-md space-y-2">
          <h2 className="text-lg font-medium">
            {t("emptyTitle", { name: siteConfig.name })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("emptyDescription")}
          </p>
        </div>
        <Link
          href="/settings"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("emptyCta")}
        </Link>
      </section>
    </div>
  );
}
