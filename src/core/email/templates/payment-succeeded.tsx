import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { formatDate, formatMoney } from "../format";
import { emailTranslator, type EmailT } from "../translator";

export type PaymentSucceededProps = {
  /** Plan display name (already resolved for the recipient's locale). */
  planName: string;
  /** subscription: first subscription period or a renewal; one_time: one-time purchase. */
  kind: "subscription" | "one_time";
  /** Amount paid, in the smallest currency unit. */
  amount?: number;
  currency?: string;
  /** Payment time, ISO. */
  paidAt: string;
  /** Next subscription renewal time, ISO. */
  renewsAt?: string;
  /** Credits granted by this payment; hidden when 0 or omitted. */
  credits?: number;
  /** Billing page (manage the subscription, view credits). */
  manageUrl: string;
};

type Props = PaymentSucceededProps & { t: EmailT; locale: string };

export function paymentSucceededSubject(
  t: EmailT,
  { planName }: PaymentSucceededProps,
) {
  return t("paymentSucceeded.subject", { plan: planName, name: brand.name });
}

export default function PaymentSucceededEmail({
  t,
  locale,
  planName,
  kind,
  amount,
  currency,
  paidAt,
  renewsAt,
  credits,
  manageUrl,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("paymentSucceeded.preview", { plan: planName })}
    >
      <Text style={emailStyles.heading}>{t("paymentSucceeded.heading")}</Text>
      <Text style={emailStyles.text}>
        {kind === "subscription"
          ? t("paymentSucceeded.bodySubscription", { plan: planName })
          : t("paymentSucceeded.bodyOneTime", { plan: planName })}
      </Text>
      <DetailRows
        rows={[
          [t("details.plan"), planName],
          [t("details.amount"), formatMoney(locale, amount, currency)],
          [t("details.date"), formatDate(locale, paidAt)],
          [
            t("details.renewsOn"),
            kind === "subscription" ? formatDate(locale, renewsAt) : null,
          ],
          [
            t("details.credits"),
            credits ? t("details.creditsValue", { credits }) : null,
          ],
        ]}
      />
      <EmailButton href={manageUrl}>{t("paymentSucceeded.cta")}</EmailButton>
      <Text style={emailStyles.muted}>{t("paymentSucceeded.receipt")}</Text>
    </EmailLayout>
  );
}

PaymentSucceededEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  planName: "Pro",
  kind: "subscription",
  amount: 1900,
  currency: "USD",
  paidAt: "2026-09-25T12:58:05.000Z",
  renewsAt: "2026-10-25T12:58:05.000Z",
  credits: 2000,
  manageUrl: `${brand.siteUrl}/billing`,
} satisfies Props;
