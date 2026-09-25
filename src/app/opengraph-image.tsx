import { ImageResponse } from "next/og";

import { ogImageSize } from "@/core/seo/og-image-size";
import { needsDarkText } from "@/core/theme/brand-css";

import siteConfig from "../../site.config";

export const alt = siteConfig.name;
export const size = ogImageSize;
export const contentType = "image/png";

// 默认分享图：品牌色背景 + 站点名称与描述。构建时生成。
export default function OpengraphImage() {
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
      <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
        {siteConfig.name}
      </div>
      <div style={{ fontSize: 40, marginTop: 24, opacity: 0.85 }}>
        {siteConfig.description}
      </div>
      <div style={{ fontSize: 28, marginTop: "auto", opacity: 0.7 }}>
        {siteConfig.domain}
      </div>
    </div>,
    size,
  );
}
