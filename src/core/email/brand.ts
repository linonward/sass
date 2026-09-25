import { needsDarkText } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";

const siteUrl = `https://${siteConfig.domain}`;

/** 邮件里用到的品牌信息。颜色一律十六进制（邮件客户端不支持 oklch），图片用绝对 URL。 */
export const emailBrand = {
  name: siteConfig.name,
  siteUrl,
  primary: siteConfig.brand.primaryColor,
  onPrimary: needsDarkText(siteConfig.brand.primaryColor)
    ? "#171717"
    : "#ffffff",
  logoUrl: siteConfig.email.logo ? `${siteUrl}${siteConfig.email.logo}` : null,
  text: "#171717",
  muted: "#737373",
  border: "#e5e5e5",
  background: "#f5f5f5",
};
