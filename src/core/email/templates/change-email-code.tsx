import { Section, Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type ChangeEmailCodeProps = {
  /** 6 位数字验证码。 */
  code: string;
  /** 有效期（分钟），与 Better Auth emailOTP 的 expiresIn 保持一致。 */
  expiresInMinutes: number;
  /** true 表示发往新邮箱（确认新地址），false 表示发往当前邮箱（确认是本人发起的变更）。 */
  forNewEmail: boolean;
};

type Props = ChangeEmailCodeProps & { t: EmailT; locale: string };

/** 两个验证码的主题不同，收件人一眼能看出这封信是确认变更还是确认新地址。 */
export function changeEmailCodeSubject(t: EmailT, props: ChangeEmailCodeProps) {
  return props.forNewEmail
    ? t("changeEmailCode.subjectNew", { name: brand.name })
    : t("changeEmailCode.subjectCurrent", { name: brand.name });
}

export default function ChangeEmailCodeEmail({
  t,
  locale,
  code,
  expiresInMinutes,
  forNewEmail,
}: Props) {
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={
        forNewEmail
          ? t("changeEmailCode.previewNew", { code, name: brand.name })
          : t("changeEmailCode.previewCurrent", { code, name: brand.name })
      }
    >
      <Text style={emailStyles.heading}>
        {forNewEmail
          ? t("changeEmailCode.headingNew")
          : t("changeEmailCode.headingCurrent")}
      </Text>
      <Text style={emailStyles.text}>
        {forNewEmail
          ? t("changeEmailCode.introNew", { name: brand.name })
          : t("changeEmailCode.introCurrent", { name: brand.name })}
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
        {t("changeEmailCode.expires", { minutes: expiresInMinutes })}
      </Text>
      <Text style={emailStyles.muted}>
        {forNewEmail
          ? t("changeEmailCode.ignoreNew")
          : t("changeEmailCode.ignoreCurrent")}
      </Text>
    </EmailLayout>
  );
}

ChangeEmailCodeEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  code: "482913",
  expiresInMinutes: 5,
  forNewEmail: false,
} satisfies Props;
