import { Text } from "react-email";

import { emailBrand as brand } from "@/core/email/brand";
import { DetailRows } from "@/core/email/components/detail-rows";
import { EmailButton } from "@/core/email/components/email-button";
import { EmailLayout, emailStyles } from "@/core/email/components/email-layout";
import { formatDate } from "@/core/email/format";
import type { EmailT } from "@/core/email/translator";

/** 「可以下载了」邮件：付款成功、授权记好之后发，链接到站内下载页（登录后下载）。 */
export type DownloadReadyProps = {
  /** 产品的显示名称（已按收件人语言取好）。 */
  productName: string;
  /** 站内下载页的绝对地址。 */
  downloadsUrl: string;
  /** 包含的更新截止时间，ISO。 */
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
