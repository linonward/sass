import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type StatusSubscriptionProps = {
  /** Confirmation URL with a token. */
  confirmUrl: string;
};

type Props = StatusSubscriptionProps & { t: EmailT; locale: string };

export function statusSubscriptionSubject(t: EmailT) {
  return t("statusSubscription.subject", { name: brand.name });
}

/** Double opt-in: the address only receives incident notices after confirming. */
export default function StatusSubscriptionEmail({
  t,
  locale,
  confirmUrl,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("statusSubscription.preview")}
    >
      <Text style={emailStyles.heading}>{t("statusSubscription.heading")}</Text>
      <Text style={emailStyles.text}>{t("statusSubscription.body")}</Text>
      <EmailButton href={confirmUrl}>{t("statusSubscription.cta")}</EmailButton>
      <Text style={emailStyles.muted}>{t("statusSubscription.ignore")}</Text>
    </EmailLayout>
  );
}

StatusSubscriptionEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  confirmUrl: `${brand.siteUrl}/status/confirm?token=preview`,
} satisfies Props;
