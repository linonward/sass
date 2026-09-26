import { DEFAULT_LOGO_PATH } from "@/core/config/logo";
import { absoluteUrl, siteUrl } from "@/core/seo/urls";

import siteConfig from "../../../site.config";
import { postOgPath, postPath, type Post } from "./posts";

/** 文章页的 BlogPosting（Article 的子类型）结构化数据。作者和发布者都是站点本身。 */
export function postJsonLd(post: Post, locale: string) {
  const url = absoluteUrl(locale, postPath(post.slug));
  const organization = {
    "@type": "Organization",
    name: siteConfig.name,
    url: siteUrl,
    logo: new URL(
      siteConfig.brand.logo ?? DEFAULT_LOGO_PATH,
      siteUrl,
    ).toString(),
  };

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    inLanguage: locale,
    url,
    mainEntityOfPage: url,
    image: absoluteUrl(locale, postOgPath(post.slug)),
    ...(post.tags.length > 0 && { keywords: post.tags }),
    author: organization,
    publisher: organization,
  };
}
