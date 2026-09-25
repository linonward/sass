import { Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { formatDate, formatMoney } from "../format";
import { emailTranslator, type EmailT } from "../translator";

export type PaymentSucceededProps = {
  /** 套餐的显示名称（已按收件人语言取好）。 */
  planName: string;
  /** subscription：订阅首期或续费；one_time：一次性购买。 */
  kind: "subscription" | "one_time";
  /** 实付金额，最小货币单位。 */
  amount?: number;
  currency?: string;
  /** 付款时间，ISO。 */
  paidAt: string;
  /** 订阅的下次续费时间，ISO。 */
  renewsAt?: string;
  /** 这次到账的积分；0 或不传时不显示。 */
  credits?: number;
  /** 账单页（管理订阅、查看积分）。 */
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
