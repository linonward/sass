import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

import { emailBrand as brand } from "../brand";
import type { EmailT } from "../translator";

/** 所有事务邮件共用的外框：品牌页眉、正文卡片、页脚。样式全部内联，兼容主流邮件客户端。 */
export function EmailLayout({
  t,
  locale,
  preview,
  children,
}: {
  t: EmailT;
  locale: string;
  preview: string;
  children: React.ReactNode;
}) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 12px",
          backgroundColor: brand.background,
          color: brand.text,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "520px", margin: "0 auto" }}>
          <Section style={{ padding: "0 8px 20px" }}>
            <Link
              href={brand.siteUrl}
              style={{ color: brand.text, textDecoration: "none" }}
            >
              {brand.logoUrl ? (
                <Img src={brand.logoUrl} alt={brand.name} height="28" />
              ) : (
                <Text style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      marginRight: "8px",
                      borderRadius: "3px",
                      backgroundColor: brand.primary,
                    }}
                  />
                  {brand.name}
                </Text>
              )}
            </Link>
          </Section>
          <Section
            style={{
              padding: "32px 28px",
              backgroundColor: "#ffffff",
              border: `1px solid ${brand.border}`,
              borderRadius: "12px",
            }}
          >
            {children}
          </Section>
          <Section style={{ padding: "20px 8px 0" }}>
            <Text style={footerText}>{t("layout.help")}</Text>
            <Hr style={{ borderColor: brand.border, margin: "12px 0" }} />
            <Text style={footerText}>
              {t("layout.footer", { name: brand.name })}{" "}
              <Link href={brand.siteUrl} style={{ color: brand.muted }}>
                {brand.siteUrl.replace("https://", "")}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const footerText = {
  margin: 0,
  fontSize: "12px",
  lineHeight: "18px",
  color: brand.muted,
};

/** 正文里常用的样式，模板间共享。 */
export const emailStyles = {
  heading: {
    margin: "0 0 16px",
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: 600,
    color: brand.text,
  },
  text: {
    margin: "0 0 16px",
    fontSize: "15px",
    lineHeight: "24px",
    color: brand.text,
  },
  muted: {
    margin: "0",
    fontSize: "13px",
    lineHeight: "20px",
    color: brand.muted,
  },
} as const;
