import { getTranslations } from "next-intl/server";

import { buildMetadata } from "@/core/seo/metadata";

/** 后台页面的 metadata：不收录，标题形如 "Users · Admin | 站点名"。 */
export async function adminMetadata(
  params: Promise<{ locale: string }>,
  path: string,
  title: (t: Awaited<ReturnType<typeof getTranslations<"Admin">>>) => string,
) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return buildMetadata({
    locale,
    path,
    title: `${title(t)} · ${t("metaTitle")}`,
    noIndex: true,
  });
}
