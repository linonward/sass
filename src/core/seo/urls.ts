import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";

export const siteUrl = `https://${siteConfig.domain}`;

/** Site-relative path in a locale, following `localePrefix: "as-needed"`: the default locale has no prefix. */
export function localizedPath(locale: string, path: string): string {
  if (locale === routing.defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Absolute URL in a locale. The home page has no trailing slash, matching the canonical Next emits. */
export function absoluteUrl(locale: string, path: string): string {
  const localized = localizedPath(locale, path);
  return localized === "/" ? siteUrl : `${siteUrl}${localized}`;
}

/**
 * hreflang map: one entry per locale, plus `x-default`.
 * Pass `locales` when a page exists in only some locales (such as blog posts); x-default prefers the
 * default locale and otherwise points at the first one.
 */
export function languageAlternates(
  path: string,
  locales: readonly string[] = routing.locales,
): Record<string, string> {
  const fallback = locales.includes(routing.defaultLocale)
    ? routing.defaultLocale
    : locales[0];
  return {
    ...Object.fromEntries(
      locales.map((locale) => [locale, absoluteUrl(locale, path)]),
    ),
    ...(fallback && { "x-default": absoluteUrl(fallback, path) }),
  };
}
