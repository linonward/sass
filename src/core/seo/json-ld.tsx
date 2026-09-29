import { DEFAULT_LOGO_PATH } from "@/core/config/logo";

import siteConfig from "../../../site.config";
import { absoluteUrl, siteUrl } from "./urls";

/** Serializes JSON-LD and escapes `<`, `>`, `&`, and line separators so content can't close the script tag and cause XSS. */
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
      logo: new URL(
        siteConfig.brand.logo ?? DEFAULT_LOGO_PATH,
        siteUrl,
      ).toString(),
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
