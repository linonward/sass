import { ogCard } from "@/core/seo/og-card";
import { ogImageSize } from "@/core/seo/og-image-size";

import siteConfig from "../../site.config";

export const alt = siteConfig.name;
export const size = ogImageSize;
export const contentType = "image/png";

// 默认分享图：品牌色背景 + 站点名称与描述。构建时生成。
export default function OpengraphImage() {
  return ogCard({
    title: siteConfig.name,
    description: siteConfig.description,
  });
}
