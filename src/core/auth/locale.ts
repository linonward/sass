import { routing } from "../i18n/routing";

/** The request header carrying the current UI locale; the auth client attaches it to every request. */
export const LOCALE_HEADER = "x-locale";

/**
 * The better-auth client's `fetchOptions.onRequest`: put the current UI locale on every request so
 * the server can pick the language of the verification code email and the welcome email (see
 * `resolveRequestLocale` below). Both the shared client (`client.ts`) and the One Tap client
 * (`one-tap.ts`) need it, so it's extracted here to keep them from drifting apart.
 */
export function withLocaleHeader(context: { headers: Headers }) {
  if (typeof document !== "undefined") {
    context.headers.set(LOCALE_HEADER, document.documentElement.lang);
  }
}

/**
 * Infer the recipient's locale from the request headers: x-locale first, then next-intl's locale
 * cookie, and finally the default locale.
 *
 * The cookie value may be truncated or hand-edited into garbage, and `decodeURIComponent` throws
 * URIError on malformed percent-encoding. If it can't be decoded, treat the cookie as absent:
 * some callers, such as `user.create.after`, don't wrap this in a try, and failing an entire
 * sign-up over one bad cookie isn't worth it.
 */
export function resolveRequestLocale(headers: Headers | undefined): string {
  const locales: readonly string[] = routing.locales;
  const fromHeader = headers?.get(LOCALE_HEADER);
  if (fromHeader && locales.includes(fromHeader)) return fromHeader;
  const cookie = headers?.get("cookie") ?? "";
  const encoded = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(cookie)?.[1];
  if (encoded) {
    const fromCookie = decodeLocaleCookie(encoded);
    if (fromCookie && locales.includes(fromCookie)) return fromCookie;
  }
  return routing.defaultLocale;
}

/** Decode the locale from the cookie; returns undefined instead of throwing on a malformed encoding. */
function decodeLocaleCookie(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
