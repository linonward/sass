import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type CreditsLowProps = {
  /** Balance after the deduction. */
  balance: number;
  /** Alert threshold (credits.lowBalanceThreshold in site.config.ts). */
  threshold: number;
  /** Page for topping up or upgrading the plan. */
  topUpUrl: string;
};

type Props = CreditsLowProps & { t: EmailT; locale: string };

export function creditsLowSubject(t: EmailT) {
  return t("creditsLow.subject", { name: brand.name });
}

export default function CreditsLowEmail({
  t,
  locale,
  balance,
  threshold,
  topUpUrl,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("creditsLow.preview", { balance })}
    >
      <Text style={emailStyles.heading}>{t("creditsLow.heading")}</Text>
      <Text style={emailStyles.text}>
        {t("creditsLow.body", { balance, threshold })}
      </Text>
      <DetailRows
        rows={[
          [
            t("details.balance"),
            t("details.creditsValue", { credits: balance }),
          ],
        ]}
      />
      <EmailButton href={topUpUrl}>{t("creditsLow.cta")}</EmailButton>
      <Text style={emailStyles.muted}>{t("creditsLow.note")}</Text>
    </EmailLayout>
  );
}

CreditsLowEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  balance: 80,
  threshold: 100,
  topUpUrl: `${brand.siteUrl}/billing`,
} satisfies Props;
