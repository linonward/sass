import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";

export const siteUrl = `https://${siteConfig.domain}`;

/** 某语言下的站内路径，遵循 `localePrefix: "as-needed"`：默认语言不带前缀。 */
export function localizedPath(locale: string, path: string): string {
  if (locale === routing.defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** 某语言下的绝对 URL。首页不带尾斜杠，与 Next 输出的 canonical 一致。 */
export function absoluteUrl(locale: string, path: string): string {
  const localized = localizedPath(locale, path);
  return localized === "/" ? siteUrl : `${siteUrl}${localized}`;
}

/** hreflang 映射：每个语言一项，外加指向默认语言的 `x-default`。 */
export function languageAlternates(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(
      routing.locales.map((locale) => [locale, absoluteUrl(locale, path)]),
    ),
    "x-default": absoluteUrl(routing.defaultLocale, path),
  };
}
