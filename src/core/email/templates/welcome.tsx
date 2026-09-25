import { Button, Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type WelcomeProps = {
  /** 用户名；为空时用通用称呼。 */
  name?: string;
  /** 按钮链接，默认是当前语言的站点首页。 */
  ctaUrl?: string;
};

type Props = WelcomeProps & { t: EmailT; locale: string };

export function welcomeSubject(t: EmailT) {
  return t("welcome.subject", { name: brand.name });
}

export default function WelcomeEmail({ t, locale, name, ctaUrl }: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("welcome.preview", { name: brand.name })}
    >
      <Text style={emailStyles.heading}>
        {t("welcome.heading", { name: brand.name })}
      </Text>
      <Text style={emailStyles.text}>
        {name?.trim()
          ? t("welcome.greeting", { name: name.trim() })
          : t("welcome.greetingAnonymous")}
      </Text>
      <Text style={emailStyles.text}>
        {t("welcome.body", { site: brand.name })}
      </Text>
      <Button
        href={ctaUrl ?? brand.siteUrl}
        style={{
          display: "inline-block",
          margin: "8px 0 24px",
          padding: "12px 20px",
          borderRadius: "8px",
          backgroundColor: brand.primary,
          color: brand.onPrimary,
          fontSize: "15px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {t("welcome.cta")}
      </Button>
      <Text style={emailStyles.muted}>
        {t("welcome.signoff", { site: brand.name })}
      </Text>
    </EmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  name: "Ada",
} satisfies Props;
