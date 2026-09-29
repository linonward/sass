import { hasLocale } from "next-intl";

import { routing } from "@/core/i18n/routing";

/**
 * The locale to use for transactional emails to this user: their preferred locale, or the site's
 * default locale when it is unset or no longer enabled.
 */
export function preferredLocale(user: { locale?: string | null }): string {
  return user.locale && hasLocale(routing.locales, user.locale)
    ? user.locale
    : routing.defaultLocale;
}
