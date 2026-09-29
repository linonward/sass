import { defineRouting } from "next-intl/routing";

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./locale-cookie";
import { defaultLocale, locales } from "./locales";

// The locale list is read from ./locales — **don't change it to read from site.config.ts**: this
// module is referenced indirectly by client components (client component →
// core/i18n/navigation.ts → here), and reading the config would drag zod and the whole config
// schema into every page's client bundle. See the comment in ./locales.ts.
export const routing = defineRouting({
  locales,
  defaultLocale,
  // The default locale has no prefix (/pricing); other locales are prefixed (/zh/pricing).
  localePrefix: "as-needed",
  // Visiting an **unprefixed** URL (/, /pricing) redirects by locale preference, in this order:
  // URL prefix → cookie → Accept-Language → default locale. A prefixed URL is always its own locale.
  // It's spelled out because it has to be **intentional**: next-intl's default also happens to be
  // true, but turning it off requires knowing the option exists (once off, a visitor with a Chinese
  // browser sees the English site by default), so it isn't omitted just to save a line. See
  // docs/i18n.md.
  localeDetection: true,
  // This option is only for **reading** the cookie (priority 2 above). Writing is the locale
  // switcher's job — the middleware writes one itself when a prefixed URL is visited, which is
  // exactly how "opening a single /zh link gets you remembered as Chinese" happens, so the proxy
  // deletes it. The name and max age are shared from ./locale-cookie.
  localeCookie: {
    name: LOCALE_COOKIE,
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  },
});
