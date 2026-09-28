import { getTranslations } from "next-intl/server";

import { LegalPage, legalMetadata } from "@/core/legal/legal-page";
import { legalPages } from "@/core/legal/pages";

import document from "../../../../../content/legal/refund";

export const generateMetadata = legalMetadata(document, legalPages.refund);

export default async function RefundPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Common" });
  return (
    <LegalPage
      document={document}
      effectiveDateLabel={t("effectiveDate")}
      locale={locale}
    />
  );
}
