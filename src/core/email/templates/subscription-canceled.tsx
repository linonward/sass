import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { formatDate } from "../format";
import { emailTranslator, type EmailT } from "../translator";

export type SubscriptionCanceledProps = {
  planName?: string;
  /** 取消后仍可使用到这个时间，ISO；不知道时不显示。 */
  endsAt?: string;
  manageUrl: string;
};

type Props = SubscriptionCanceledProps & { t: EmailT; locale: string };

export function subscriptionCanceledSubject(t: EmailT) {
  return t("subscriptionCanceled.subject", { name: brand.name });
}

export default function SubscriptionCanceledEmail({
  t,
  locale,
  planName,
  endsAt,
  manageUrl,
}: Props) {
  const endDate = formatDate(locale, endsAt);
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("subscriptionCanceled.preview")}
    >
      <Text style={emailStyles.heading}>
        {t("subscriptionCanceled.heading")}
      </Text>
      <Text style={emailStyles.text}>
        {endDate
          ? t("subscriptionCanceled.bodyUntil", {
              plan: planName ?? brand.name,
              date: endDate,
            })
          : t("subscriptionCanceled.body", { plan: planName ?? brand.name })}
      </Text>
      <DetailRows
        rows={[
          [t("details.plan"), planName],
          [t("details.accessUntil"), endDate],
        ]}
      />
      <EmailButton href={manageUrl}>
        {t("subscriptionCanceled.cta")}
      </EmailButton>
      <Text style={emailStyles.muted}>{t("subscriptionCanceled.note")}</Text>
    </EmailLayout>
  );
}

SubscriptionCanceledEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  planName: "Pro",
  endsAt: "2026-10-25T12:58:05.000Z",
  manageUrl: `${brand.siteUrl}/billing`,
} satisfies Props;
