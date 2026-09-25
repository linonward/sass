import siteConfig from "../../../site.config";
import { absoluteUrl, siteUrl } from "./urls";

/** 序列化 JSON-LD 并转义 `<`、`>`、`&` 和行分隔符，防止内容闭合 script 标签造成 XSS。 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function siteJsonLd(locale: string) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: siteConfig.name,
      url: siteUrl,
      logo: new URL(siteConfig.brand.logo, siteUrl).toString(),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.name,
      url: absoluteUrl(locale, "/"),
      inLanguage: locale,
    },
  ];
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
