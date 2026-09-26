import { routing } from "../i18n/routing";

/** 请求头里携带当前界面语言的字段，由 auth client 在每个请求上附带。 */
export const LOCALE_HEADER = "x-locale";

/**
 * better-auth 客户端的 `fetchOptions.onRequest`：把当前界面语言放到每个请求上，
 * 服务端据此选择验证码邮件和欢迎邮件的语言（见下面的 `resolveRequestLocale`）。
 * 共享客户端（`client.ts`）和 One Tap 的客户端（`one-tap.ts`）都要带，抽出来免得两边漂移。
 */
export function withLocaleHeader(context: { headers: Headers }) {
  if (typeof document !== "undefined") {
    context.headers.set(LOCALE_HEADER, document.documentElement.lang);
  }
}

/** 从请求头推断收件人的语言：先看 x-locale，再看 next-intl 的语言 cookie，最后用默认语言。 */
export function resolveRequestLocale(headers: Headers | undefined): string {
  const locales: readonly string[] = routing.locales;
  const fromHeader = headers?.get(LOCALE_HEADER);
  if (fromHeader && locales.includes(fromHeader)) return fromHeader;
  const cookie = headers?.get("cookie") ?? "";
  const match = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(cookie);
  if (match && locales.includes(decodeURIComponent(match[1]))) {
    return decodeURIComponent(match[1]);
  }
  return routing.defaultLocale;
}
