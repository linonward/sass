import { getTranslations } from "next-intl/server";

import { buildMetadata } from "@/core/seo/metadata";

/** Metadata for admin pages: noindex, with titles like "Users · Admin | Site Name". */
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
