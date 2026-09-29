/**
 * The cookie that remembers the user's locale choice. **This module imports nothing** (same reason
 * as ./locales.ts): edge middleware (`src/proxy.ts`), a client component (`./locale-switcher.tsx`),
 * and e2e assertions all read it, and none of them should drag in dependencies for a constant.
 *
 * It means "the user explicitly chose this locale", not "the visitor has been on a page in this
 * locale": only the locale switcher writes it, and the copy the middleware writes itself is deleted
 * by the proxy. See src/proxy.ts for why.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** One year. next-intl sets no max-age by default (a session cookie that's forgotten when the browser restarts), so this makes it an explicit persistent cookie. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
