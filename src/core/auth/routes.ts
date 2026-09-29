import siteConfig from "../../../site.config";

/** Sign-in page path (without the locale prefix). */
export const SIGN_IN_PATH = "/sign-in";

/** Default page after sign-in (without the locale prefix). */
export const AFTER_SIGN_IN_PATH = "/dashboard";

/** Whether a path falls under a prefix (`/a` covers `/a` and `/a/b`, but not `/ab`). */
function underPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Pages whose existence depends on a module flag. When enabled they require sign-in as usual (and
 * go into protectedPrefixes); when disabled the whole section goes offline: the proxy returns 404
 * before rendering (see disabledPrefixes).
 */
const moduleGatedPages: ReadonlyArray<{ href: string; enabled: boolean }> = [
  // Referral page: when disabled, the page itself also calls notFound(), but the (app) layout sends
  // signed-out visitors to sign-in first (the layout renders first), so the real check must
  // happen in the proxy.
  { href: "/referrals", enabled: siteConfig.acquisition.referrals.enabled },
  // Example business module (invoices, src/features/invoices/): when disabled, /invoices goes
  // offline entirely; when enabled it requires sign-in like other (app) pages — after sign-in,
  // callbackURL brings the user back to the original page.
  { href: "/invoices", enabled: siteConfig.features.examples.invoices },
];

/**
 * Path prefixes that require sign-in (without the locale prefix), matching the pages under
 * `src/app/[locale]/(app)/`. The proxy uses them for a fast cookie-based gate (with a callbackURL
 * so the user returns to the original page after sign-in); the (app) layout also checks the
 * session on the server as a backstop. Business pages added to dashboard.nav in site.config.ts are
 * included automatically; no need to edit this list.
 */
export const protectedPrefixes: readonly string[] = [
  "/dashboard",
  "/settings",
  "/billing",
  "/playground",
  // The referral page requires sign-in only when the module is enabled; when disabled, see
  // disabledPrefixes (it 404s there).
  ...moduleGatedPages.filter((page) => page.enabled).map((page) => page.href),
  // Same for the API key page: apiKeys.enabled in site.config.ts decides whether it really exists.
  "/api-keys",
  ...siteConfig.dashboard.nav.map((item) => item.href),
];

/**
 * Page paths that no longer exist once their module is disabled (without the locale prefix). The
 * proxy returns 404 for them directly: the (app) layout and page render in parallel, but the
 * layout finishes first and sends signed-out visitors to sign-in, so the same URL would be a 307
 * when signed out and a 404 when signed in. Moving the check before rendering makes both cases
 * consistent (the same reasoning as `/admin` returning 404 for every non-admin; see the README
 * section on error and permission boundaries).
 */
export const disabledPrefixes: readonly string[] = moduleGatedPages
  .filter((page) => !page.enabled)
  .map((page) => page.href);

export function isProtectedPath(path: string) {
  return protectedPrefixes.some((prefix) => underPrefix(path, prefix));
}

export function isDisabledPath(path: string) {
  return disabledPrefixes.some((prefix) => underPrefix(path, prefix));
}
