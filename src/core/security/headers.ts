/**
 * Site-wide security response headers. `headers()` in `next.config.ts` uses them to cover every
 * path at once — including `/api`, `/_next`, `/monitoring`, and files with extensions, which the
 * `src/proxy.ts` matcher deliberately excludes.
 *
 * **The CSP is a static policy without a nonce.** A nonce has to be regenerated on every request,
 * and Next only writes it into inline scripts during dynamic rendering, so enabling a nonce means
 * giving up static prerendering and CDN caching site-wide (see "Static vs Dynamic Rendering with
 * CSP" in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). The cost is
 * that `script-src` must keep `'unsafe-inline'`: that's the only way to allow inline scripts that
 * have no nonce (the RSC data Next injects, the next-themes theme script). The site never renders
 * user content as HTML, so inline scripts still only come from its own build output.
 *
 * Think before changing the allowlist: adding an entry only loosens it, but missing one means
 * **the browser blocks that resource outright** (generated images turn into broken images, scripts
 * don't run), and blocked resources often fail silently.
 */

// Loaded by next.config.ts, which doesn't resolve the `@/` alias, so use relative paths.
import { googleClientId } from "../auth/env";

export type SecurityHeader = { key: string; value: string };

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Script origin for Vercel Analytics / Speed Insights. Production on Vercel uses the same-origin
 * `/_vercel/*`; local development and deployments not on Vercel use the debug scripts on this
 * origin (the SDKs choose by `NODE_ENV`; see `getScriptSrc` in both packages).
 */
const VERCEL_SCRIPTS_ORIGIN = "https://va.vercel-scripts.com";

/**
 * The three Google Identity Services (One Tap) origins, per the official docs:
 * https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
 * - `gsi/client`: the script itself (GIS can't be self-hosted);
 * - `gsi/`: the parent URL of the One Tap prompt and button iframes, plus the GIS service
 *   endpoints (the docs recommend using this parent URL for `connect-src` too, rather than listing
 *   each endpoint);
 * - `gsi/style`: the stylesheet for the button inside the iframe.
 *
 * Only loosened when Google sign-in is enabled (see the `google` check in `contentSecurityPolicy`):
 * without credentials, the sign-in page never loads this script.
 */
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const GIS_PARENT = "https://accounts.google.com/gsi/";
const GIS_STYLE = "https://accounts.google.com/gsi/style";

/**
 * Host of Google profile pictures. Signing in with Google (the OAuth redirect or One Tap) stores
 * the ID token's `picture` claim as `user.image`, a `https://lh3.googleusercontent.com/a/...` URL,
 * and the dashboard user menu renders it as an `<img>`.
 *
 * Only `lh3`, not `*.googleusercontent.com`: that parent domain also serves arbitrary user-uploaded
 * content for many Google products, and account avatars come from `lh3` today (the older
 * `lh4`–`lh6` hosts show up in legacy Google+ photo URLs, not in the `picture` claim). If Google
 * ever moves a profile picture to another host, the avatar only falls back to the user's initials;
 * nothing else breaks.
 *
 * Only loosened when Google sign-in is enabled: no other sign-in method sets a remote `user.image`.
 */
const GOOGLE_AVATAR_ORIGIN = "https://lh3.googleusercontent.com";

/**
 * R2's S3-compatible API origin: direct browser uploads (presigned PUT) and signed GETs for private
 * files both go here. A wildcard instead of `<account>.r2.cloudflarestorage.com`: the CSP is a
 * public response header, so there's no reason to show every visitor the account ID; the domain
 * belongs to Cloudflare and only accepts signed requests.
 */
const R2_API_ORIGIN = "https://*.r2.cloudflarestorage.com";

/** The origin of `R2_PUBLIC_URL` (generated images/videos use it directly when `upload.public` is true). */
function r2PublicOrigin(runtimeEnv: RuntimeEnv): string | undefined {
  const value = runtimeEnv.R2_PUBLIC_URL?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    // Without R2 configured locally, this may be empty or not a valid URL; just drop the allowlist
    // entry without raising an error here (when `upload.public` is true, upload's env validation
    // catches a missing value in production first).
    return undefined;
  }
}

/**
 * Image sources for generated results: the public domain + the R2 API origin (signed GET URLs when
 * `upload.public` is false).
 */
function mediaOrigins(runtimeEnv: RuntimeEnv): string[] {
  const publicOrigin = r2PublicOrigin(runtimeEnv);
  return publicOrigin ? [R2_API_ORIGIN, publicOrigin] : [R2_API_ORIGIN];
}

/**
 * Content Security Policy.
 *
 * Where the allowlist entries come from:
 * - `script-src` / `connect-src`: Vercel Analytics and Speed Insights;
 * - `img-src` / `media-src` / `connect-src`: R2 (generated results, direct uploads);
 * - `script-src` / `style-src` / `connect-src` / `frame-src`: Google One Tap, **only when Google
 *   sign-in is enabled** (see below);
 * - `img-src`: Google profile pictures (`user.image` after a Google sign-in), under the same switch;
 * - `'self'` in `connect-src` covers Sentry's tunnel path `/monitoring` (`tunnelRoute` in
 *   `next.config.ts`, which sends reports through the site's own origin). **If you turn off
 *   tunnelRoute, add Sentry's ingest domain here.**
 *
 * Note that this reads **build-time** environment variables (`next.config.ts` calls it once at
 * startup), not per request. When self-hosting, injecting `GOOGLE_CLIENT_ID` only at runtime
 * leads to "the sign-in page has the button, but One Tap is silently blocked" — the same class of
 * problem as `R2_PUBLIC_URL`.
 */
export function contentSecurityPolicy({
  runtimeEnv,
  isDev,
}: {
  runtimeEnv: RuntimeEnv;
  isDev: boolean;
}): string {
  // The sign-in page only loads the GIS script when Google is enabled, and only Google sign-ins
  // store a remote avatar URL, so the allowlist follows the same switch: without credentials (local, CI, Vercel previews) the policy isn't loosened at
  // all.
  const google = Boolean(googleClientId(runtimeEnv));

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline': the RSC data scripts Next injects and the next-themes theme script are
    // inline, and a static CSP has no nonce to use. 'unsafe-eval' is only needed in development
    // (React uses it to rebuild server error stacks).
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      VERCEL_SCRIPTS_ORIGIN,
      ...(google ? [GIS_SCRIPT] : []),
    ],
    // 'unsafe-inline' covers both inline <style> and style="..." attributes in components.
    "style-src": ["'self'", "'unsafe-inline'", ...(google ? [GIS_STYLE] : [])],
    "img-src": [
      "'self'",
      "blob:",
      "data:",
      ...mediaOrigins(runtimeEnv),
      ...(google ? [GOOGLE_AVATAR_ORIGIN] : []),
    ],
    "media-src": ["'self'", "blob:", ...mediaOrigins(runtimeEnv)],
    // next/font downloads fonts to /_next/static/media at build time, so there are no external
    // connections at runtime.
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      VERCEL_SCRIPTS_ORIGIN,
      ...mediaOrigins(runtimeEnv),
      ...(google ? [GIS_PARENT] : []),
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // The One Tap prompt is an iframe; send this directive only when it's enabled.
    // **It must include `'self'`**: once frame-src is present, it replaces the default-src fallback
    // for frames, and leaving out `'self'` would also block the site's own same-origin iframes —
    // the "/admin can't be framed" test in `e2e/security-headers.spec.ts` relies on a same-origin
    // iframe actually loading and then being refused by X-Frame-Options to get that console
    // message. When disabled, the directive isn't sent at all, leaving the policy unchanged.
    ...(google ? { "frame-src": ["'self'", GIS_PARENT] } : {}),
    "frame-ancestors": ["'none'"],
    // Local is http, and upgrading would force dev subresources to https; in production it upgrades
    // any stray http subresources to https.
    ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

/**
 * Security headers sent on every response. HSTS is **not here**: sent before the domain is final,
 * browsers would remember it; the launch checklist (README) turns it on manually as one step.
 */
export function staticSecurityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Clickjacking protection; sent alongside CSP frame-ancestors, which newer browsers prefer.
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];
}

/** The return value for `headers()` in `next.config.ts`. */
export function securityHeaders({
  runtimeEnv,
  isDev,
}: {
  runtimeEnv: RuntimeEnv;
  isDev: boolean;
}): SecurityHeader[] {
  return [
    ...staticSecurityHeaders(),
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy({ runtimeEnv, isDev }),
    },
  ];
}
