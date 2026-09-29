const ORIGIN = "http://callback.invalid";

/**
 * Sanitize the post-sign-in redirect target: accept only same-site relative paths, to prevent open
 * redirects. Returns fallback when the value is invalid, points off-site, or points back at the
 * sign-in page itself.
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
