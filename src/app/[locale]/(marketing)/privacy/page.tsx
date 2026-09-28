import { getTranslations } from "next-intl/server";

import { LegalPage, legalMetadata } from "@/core/legal/legal-page";
import { legalPages } from "@/core/legal/pages";

import document from "../../../../../content/legal/privacy";

export const generateMetadata = legalMetadata(document, legalPages.privacy);

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Common" });
  return (
    <LegalPage document={document} effectiveDateLabel={t("effectiveDate")} />
  );
}
