import { foregroundFor, INK, neutralScale } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";

const siteUrl = `https://${siteConfig.domain}`;

const neutral = neutralScale(siteConfig.brand.primaryColor);

/**
 * 邮件里用到的品牌信息。颜色一律十六进制（邮件客户端不支持 CSS 变量，也不支持 oklch），
 * 图片用绝对 URL。
 *
 * 这些值全部取自 `brand-css` 的亮色 token —— 邮件内联不了 CSS 变量，但「用哪个色」
 * 必须和站内是同一个决策、同一组值：`onPrimary` 就是 `foregroundFor`（`--primary-foreground`
 * 用的那个），中性色就是 `neutralScale`（`--foreground` / `--muted-foreground` /
 * `--border` / `--background`）。以前这里写的是另一套冷灰，买家换品牌色后邮件会和
 * 站点对不上（暖墨 vs 纯灰）。
 */
export const emailBrand = {
  name: siteConfig.name,
  siteUrl,
  primary: siteConfig.brand.primaryColor,
  onPrimary: foregroundFor(siteConfig.brand.primaryColor),
  logoUrl: siteConfig.email.logo ? `${siteUrl}${siteConfig.email.logo}` : null,
  text: INK,
  muted: neutral.mutedForeground,
  border: neutral.border,
  background: neutral.canvas,
};
