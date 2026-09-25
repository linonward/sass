import { ImageResponse } from "next/og";

import { needsDarkText } from "@/core/theme/brand-css";

import siteConfig from "../../../site.config";
import { ogImageSize } from "./og-image-size";

export type OgCardProps = {
  /** 标题上方的小字，例如 "Acme · Blog"。 */
  eyebrow?: string;
  title: string;
  description?: string;
  /** 底部的小字，默认是站点域名。 */
  footer?: string;
};

/** 品牌色背景的分享图（1200×630）：站点默认图和博客文章图共用。 */
export function ogCard({
  eyebrow,
  title,
  description,
  footer = siteConfig.domain,
}: OgCardProps) {
  // next/og 不支持 oklch，这里用十六进制颜色。
  const color = needsDarkText(siteConfig.brand.primaryColor)
    ? "#0a0a0a"
    : "#fafafa";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 96,
        background: siteConfig.brand.primaryColor,
        color,
      }}
    >
      {eyebrow && (
        <div style={{ fontSize: 32, marginBottom: 24, opacity: 0.8 }}>
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: title.length > 40 ? 72 : 96,
          fontWeight: 700,
          letterSpacing: -2,
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 40, marginTop: 24, opacity: 0.85 }}>
          {description}
        </div>
      )}
      <div style={{ fontSize: 28, marginTop: "auto", opacity: 0.7 }}>
        {footer}
      </div>
    </div>,
    ogImageSize,
  );
}
