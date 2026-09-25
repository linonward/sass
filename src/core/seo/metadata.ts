import type { Metadata } from "next";

import siteConfig from "../../../site.config";
import { ogImageSize } from "./og-image-size";
import { absoluteUrl, languageAlternates, siteUrl } from "./urls";

export type BuildMetadataOptions = {
  locale: string;
  /** 不含语言前缀的站内路径，例如 "/" 或 "/privacy"。 */
  path: string;
  /** 页面标题，会套用 `%s | 站点名` 模板。省略时使用站点名（用于首页和根布局）。 */
  title?: string;
  /** 省略时使用站点描述。 */
  description?: string;
  /** 分享图的站内路径或绝对 URL，默认使用 `src/app/opengraph-image.tsx` 生成的品牌图。 */
  image?: string;
  /** 不希望被搜索引擎收录的页面设为 true。 */
  noIndex?: boolean;
};

const defaultImage = {
  url: "/opengraph-image",
  width: ogImageSize.width,
  height: ogImageSize.height,
  alt: siteConfig.name,
};

/**
 * 统一生成页面 metadata：title 模板、description、canonical、hreflang、Open Graph、Twitter。
 * 根布局在 [locale] 下，app 根目录的 opengraph-image 不会被自动注入，所以显式引用。
 */
export function buildMetadata({
  locale,
  path,
  title,
  description = siteConfig.description,
  image,
  noIndex = false,
}: BuildMetadataOptions): Metadata {
  const fullTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name;
  const url = absoluteUrl(locale, path);
  const images = [image ? { url: image } : defaultImage];

  return {
    metadataBase: new URL(siteUrl),
    title: title
      ? { absolute: fullTitle }
      : { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(path),
    },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      locale,
      url,
      title: fullTitle,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images,
    },
    ...(noIndex && { robots: { index: false, follow: false } }),
  };
}
