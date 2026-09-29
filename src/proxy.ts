import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import {
  isDisabledPath,
  isProtectedPath,
  SIGN_IN_PATH,
} from "@/core/auth/routes";
import { routing } from "@/core/i18n/routing";
import { localizedPath } from "@/core/seo/urls";

const intl = createMiddleware(routing);

/** Split the locale prefix off a path; with no prefix, it's the default locale. */
export function splitLocale(pathname: string) {
  const [, first = "", ...rest] = pathname.split("/");
  if ((routing.locales as readonly string[]).includes(first)) {
    return { locale: first, path: `/${rest.join("/")}` };
  }
  return { locale: routing.defaultLocale, path: pathname };
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, path } = splitLocale(pathname);

  // Pages taken offline by a disabled module 404 right here: the (app) layout finishes rendering
  // before the page, so if we left it to the page's notFound(), signed-out visitors would be sent to
  // sign-in first — one URL, two identities, two results. Deciding before rendering gives signed-in
  // and signed-out visitors the same 404.
  if (isDisabledPath(path)) return new NextResponse(null, { status: 404 });

  // Fast check: no session cookie means straight to sign-in. Whether the cookie is valid is checked by
  // the (app) layout. The sign-in page's locale comes from the URL prefix (default locale when there
  // is none) — this runs before locale detection, so a prefixed URL like `/zh/dashboard` goes to the
  // same-locale sign-in page, and an unprefixed one like `/dashboard` always goes to the default
  // locale's sign-in page.
  if (isProtectedPath(path) && !getSessionCookie(request)) {
    const signIn = new URL(localizedPath(locale, SIGN_IN_PATH), request.url);
    signIn.searchParams.set("callbackURL", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  const response = intl(request);

  // The locale cookie means "the user explicitly chose this locale", so **only** the locale switcher
  // writes it (core/i18n/locale-switcher.tsx). The middleware writes one on its own whenever a
  // prefixed URL is visited, which means an English visitor who opens a shared /zh link gets
  // permanently recorded as Chinese — every later visit to / is sent to /zh. This is the only cookie
  // the middleware writes (syncCookie in next-intl/middleware), so dropping the whole header is safe;
  // e2e/i18n/detection.spec.ts locks this behavior.
  response.headers.delete("set-cookie");

  // Where an unprefixed URL redirects depends on Accept-Language, so the cache key must include it;
  // otherwise a Chinese visitor's 307 gets cached and served to English visitors (and vice versa). A
  // prefixed URL is always its own locale, so adding Vary there would just split the CDN cache for
  // nothing.
  //
  // Only responses the middleware returns itself (redirects) actually carry this header: when the
  // request continues, Next rebuilds the Vary of the 200 response (observed:
  // `rsc, next-router-*, Accept-Encoding`), and the middleware's value never reaches the client.
  // That's enough — a 200 body doesn't depend on Accept-Language anyway (an unprefixed 200 is the
  // default locale's page); the redirect is what really needs to vary by locale. And on Vercel the
  // middleware runs before the CDN cache (observed: a request with zh still gets the 307 even when
  // the page is cached), so the cache can't mix the two up either.
  if (path === pathname) response.headers.append("vary", "Accept-Language");

  return response;
}

export const config = {
  // Skip the API, Next internals, static files with an extension (including sitemap.xml /
  // robots.txt), metadata routes at the app root, and Sentry's tunnel path (SENTRY_TUNNEL_ROUTE; the
  // matcher only accepts literals). Metadata routes must be listed here: the URLs they inject have
  // no locale prefix (`/icon`, `/opengraph-image`), and once next-intl rewrites them to
  // `/<locale>/icon` they 404 — and the tab goes blank again. `icon$` anchors the whole segment so
  // ordinary pages like `/icons` aren't excluded too. `api/` rather than `api`: exclude only the
  // `/api/**` endpoints; otherwise page paths starting with api (`/api-keys`) would skip locale
  // rewriting as well — visited without a prefix they'd land on `[locale] = "api-keys"` and 404.
  matcher:
    "/((?!api/|trpc|_next|_vercel|opengraph-image|icon$|monitoring|.*\\..*).*)",
};
