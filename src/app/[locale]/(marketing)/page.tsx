import { getTranslations } from "next-intl/server";

import { Landing } from "@/core/marketing/landing";
import { buildMetadata } from "@/core/seo/metadata";

import siteConfig from "../../../../site.config";

// 首页不能只用站点名当标题：搜索结果里只剩 "Acme"，看不出这页是做什么的。
export async function generateMetadata({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return buildMetadata({
    locale,
    path: "/",
    title: t("homeTitle"),
    description: t("description"),
  });
}

export default function Home() {
  return <Landing config={siteConfig} />;
}
