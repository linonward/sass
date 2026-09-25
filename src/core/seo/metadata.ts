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
  /** 分享图的站内路径或绝对 URL（可带尺寸），默认使用 `src/app/opengraph-image.tsx` 生成的品牌图。 */
  image?: string | { url: string; width: number; height: number; alt?: string };
  /** 不希望被搜索引擎收录的页面设为 true。 */
  noIndex?: boolean;
  /** 页面只有部分语言的版本时，列出有版本的语言，hreflang 只输出这些。默认是全部语言。 */
  locales?: readonly string[];
  /** 文章页传入，Open Graph 类型改为 article 并带上发布时间和标签。 */
  article?: { publishedTime: string; tags: string[] };
  /** 额外的 `<link rel="alternate">`，按 MIME 类型分组，例如 RSS。 */
  feeds?: Record<string, { url: string; title: string }[]>;
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
  locales,
  article,
  feeds,
}: BuildMetadataOptions): Metadata {
  const fullTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name;
  const url = absoluteUrl(locale, path);
  const images = [
    typeof image === "string" ? { url: image } : (image ?? defaultImage),
  ];

  return {
    metadataBase: new URL(siteUrl),
    title: title
      ? { absolute: fullTitle }
      : { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(path, locales),
      ...(feeds && { types: feeds }),
    },
    openGraph: {
      ...(article
        ? { type: "article", ...article }
        : { type: "website" as const }),
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
