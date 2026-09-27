import { Button, Link, Text } from "react-email";
import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";
export type LeadConfirmationProps = {
  listTitle: string;
  confirmUrl: string;
  withdrawUrl: string;
};
type Props = LeadConfirmationProps & { t: EmailT; locale: string };
export function leadConfirmationSubject(t: EmailT) {
  return t("leadConfirmation.subject", { name: brand.name });
}
export default function LeadConfirmationEmail({
  t,
  locale,
  listTitle,
  confirmUrl,
  withdrawUrl,
}: Props) {
  return (
    <EmailLayout t={t} locale={locale} preview={t("leadConfirmation.preview")}>
      <Text style={emailStyles.heading}>
        {t("leadConfirmation.heading", { list: listTitle })}
      </Text>
      <Text style={emailStyles.text}>{t("leadConfirmation.body")}</Text>
      <Button
        href={confirmUrl}
        style={{
          backgroundColor: brand.primary,
          color: brand.onPrimary,
          padding: "12px 20px",
          borderRadius: "8px",
        }}
      >
        {t("leadConfirmation.confirm")}
      </Button>
      <Text style={emailStyles.text}>{t("leadConfirmation.ignore")}</Text>
      <Link href={withdrawUrl}>{t("leadConfirmation.withdraw")}</Link>
    </EmailLayout>
  );
}
LeadConfirmationEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  listTitle: "Waitlist",
  confirmUrl: "https://example.com/waitlist/confirm",
  withdrawUrl: "https://example.com/waitlist/withdraw",
} satisfies Props;
