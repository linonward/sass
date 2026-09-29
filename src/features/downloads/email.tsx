import { Text } from "react-email";

import { emailBrand as brand } from "@/core/email/brand";
import { DetailRows } from "@/core/email/components/detail-rows";
import { EmailButton } from "@/core/email/components/email-button";
import { EmailLayout, emailStyles } from "@/core/email/components/email-layout";
import { formatDate } from "@/core/email/format";
import type { EmailT } from "@/core/email/translator";

/**
 * "Ready to download" email: sent after payment succeeds and the grant is recorded; links to the
 * downloads page on the site (download after signing in).
 */
export type DownloadReadyProps = {
  /** The product's display name (already resolved in the recipient's locale). */
  productName: string;
  /** Absolute URL of the downloads page on the site. */
  downloadsUrl: string;
  /** When included updates end, ISO. */
  updatesUntil: string;
};

type Props = DownloadReadyProps & { t: EmailT; locale: string };

export function downloadReadySubject(
  t: EmailT,
  { productName }: DownloadReadyProps,
) {
  return t("downloadReady.subject", { product: productName, name: brand.name });
}

export default function DownloadReadyEmail({
  t,
  locale,
  productName,
  downloadsUrl,
  updatesUntil,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("downloadReady.preview", { product: productName })}
    >
      <Text style={emailStyles.heading}>{t("downloadReady.heading")}</Text>
      <Text style={emailStyles.text}>
        {t("downloadReady.body", { product: productName })}
      </Text>
      <DetailRows
        rows={[
          [t("downloadReady.product"), productName],
          [t("downloadReady.updatesUntil"), formatDate(locale, updatesUntil)],
        ]}
      />
      <EmailButton href={downloadsUrl}>{t("downloadReady.cta")}</EmailButton>
      <Text style={emailStyles.muted}>{t("downloadReady.signIn")}</Text>
    </EmailLayout>
  );
}
