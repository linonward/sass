const ORIGIN = "http://callback.invalid";

/**
 * 清洗登录后的跳转地址，只接受站内相对路径，防止开放重定向。
 * 不合法、指向站外或指回登录页本身时返回 fallback。
 */
export function safeCallbackURL(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value || !value.startsWith("/") || /^\/[/\\]/.test(value)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== ORIGIN) return fallback;
  if (/^(\/[^/]+)?\/sign-in\/?$/.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
