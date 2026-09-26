import { LayoutDashboardIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/core/auth/session";
import { Link } from "@/core/i18n/navigation";
import { buildMetadata } from "@/core/seo/metadata";
import { buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
import { UploadExample } from "@/core/upload/upload-example";

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
      <PageHeader
        title={t("title")}
        description={
          <span data-testid="signed-in-as">
            {name
              ? t("welcomeName", { name })
              : t("welcome", { email: session?.user.email ?? "" })}
          </span>
        }
      />
      <section className="panel">
        <EmptyState
          titleAs="h2"
          icon={<LayoutDashboardIcon />}
          title={t("emptyTitle", { name: siteConfig.name })}
          description={t("emptyDescription")}
        >
          {/* 一屏一个实心主操作：空状态的下一步就这一个。 */}
          <Link href="/settings" className={buttonVariants()}>
            {t("emptyCta")}
          </Link>
        </EmptyState>
      </section>
      {siteConfig.features.upload && (
        <UploadExample accept={siteConfig.upload.allowedMimeTypes} />
      )}
    </div>
  );
}
