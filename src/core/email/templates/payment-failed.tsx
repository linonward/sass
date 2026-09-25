import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { formatMoney } from "../format";
import { emailTranslator, type EmailT } from "../translator";

export type PaymentFailedProps = {
  planName?: string;
  amount?: number;
  currency?: string;
  /** 账单页：用户在这里打开客户门户更新付款方式。 */
  manageUrl: string;
};

type Props = PaymentFailedProps & { t: EmailT; locale: string };

export function paymentFailedSubject(t: EmailT) {
  return t("paymentFailed.subject", { name: brand.name });
}

export default function PaymentFailedEmail({
  t,
  locale,
  planName,
  amount,
  currency,
  manageUrl,
}: Props) {
  return (
    <EmailLayout t={t} locale={locale} preview={t("paymentFailed.preview")}>
      <Text style={emailStyles.heading}>{t("paymentFailed.heading")}</Text>
      <Text style={emailStyles.text}>
        {planName
          ? t("paymentFailed.body", { plan: planName })
          : t("paymentFailed.bodyGeneric")}
      </Text>
      <DetailRows
        rows={[
          [t("details.plan"), planName],
          [t("details.amount"), formatMoney(locale, amount, currency)],
        ]}
      />
      <EmailButton href={manageUrl}>{t("paymentFailed.cta")}</EmailButton>
      <Text style={emailStyles.muted}>{t("paymentFailed.note")}</Text>
    </EmailLayout>
  );
}

PaymentFailedEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  planName: "Pro",
  amount: 1900,
  currency: "USD",
  manageUrl: `${brand.siteUrl}/billing`,
} satisfies Props;
