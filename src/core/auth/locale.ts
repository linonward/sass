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

/**
 * 从请求头推断收件人的语言：先看 x-locale，再看 next-intl 的语言 cookie，最后用默认语言。
 *
 * cookie 的值可能被截断或被手工改坏，而 `decodeURIComponent` 遇到残缺的百分号编码会抛
 * URIError。解不出来就当作没写这条 cookie：调用方里有 `user.create.after` 这种不在 try
 * 里的路径，为一条坏 cookie 把整个注册弄失败不划算。
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

/** 解出 cookie 里的语言；编码残缺时返回 undefined，不抛错。 */
function decodeLocaleCookie(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
