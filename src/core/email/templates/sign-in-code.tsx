import { Section, Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type SignInCodeProps = {
  /** 6-digit verification code. */
  code: string;
  /** Validity in minutes; matches Better Auth emailOTP's expiresIn. */
  expiresInMinutes: number;
};

type Props = SignInCodeProps & { t: EmailT; locale: string };

export function signInCodeSubject(t: EmailT) {
  return t("signInCode.subject", { name: brand.name });
}

export default function SignInCodeEmail({
  t,
  locale,
  code,
  expiresInMinutes,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t("signInCode.preview", { code, name: brand.name })}
    >
      <Text style={emailStyles.heading}>{t("signInCode.heading")}</Text>
      <Text style={emailStyles.text}>
        {t("signInCode.intro", { name: brand.name })}
      </Text>
      <Section
        style={{
          margin: "8px 0 24px",
          padding: "16px",
          textAlign: "center",
          backgroundColor: brand.background,
          borderRadius: "8px",
        }}
      >
        <Text
          style={{
            margin: 0,
            fontSize: "32px",
            lineHeight: "40px",
            fontWeight: 700,
            letterSpacing: "8px",
            fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
            color: brand.text,
          }}
        >
          {code}
        </Text>
      </Section>
      <Text style={emailStyles.text}>
        {t("signInCode.expires", { minutes: expiresInMinutes })}
      </Text>
      <Text style={emailStyles.muted}>{t("signInCode.ignore")}</Text>
    </EmailLayout>
  );
}

SignInCodeEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  code: "482913",
  expiresInMinutes: 5,
} satisfies Props;
