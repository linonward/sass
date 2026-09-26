import { routing } from "../i18n/routing";

/** 请求头里携带当前界面语言的字段，由 auth client 在每个请求上附带。 */
export const LOCALE_HEADER = "x-locale";

/** 从请求头推断收件人的语言：先看 x-locale，再看 next-intl 的语言 cookie，最后用默认语言。 */
export function resolveRequestLocale(headers: Headers | undefined): string {
  const locales: readonly string[] = routing.locales;
  const fromHeader = headers?.get(LOCALE_HEADER);
  if (fromHeader && locales.includes(fromHeader)) return fromHeader;
  const cookie = headers?.get("cookie") ?? "";
  const encoded = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(cookie)?.[1];
  if (encoded) {
    const fromCookie = decodeURIComponent(encoded);
    if (locales.includes(fromCookie)) return fromCookie;
  }
  return routing.defaultLocale;
}
