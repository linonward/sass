import { routing } from "@/core/i18n/routing";

import { emailBrand } from "./brand";

/**
 * Absolute URL to a site page for use in emails, with the recipient's locale prefix (none for the
 * default locale).
 */
export function siteLink(locale: string, path: string) {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${emailBrand.siteUrl}${prefix}${path}`;
}
