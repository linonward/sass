import type { NextConfig } from "next";
import { withContentCollections } from "@content-collections/next";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

// Validates site.config.ts and environment variables when dev / build starts, failing immediately
// on errors.
import siteConfig from "./site.config";
import "./src/core/env";
import { canUploadSourceMaps } from "./src/core/observability/env";
import { SENTRY_TUNNEL_ROUTE } from "./src/core/observability/tunnel";
import { securityHeaders } from "./src/core/security/headers";

const withNextIntl = createNextIntlPlugin("./src/core/i18n/request.ts");

const sentryEnabled =
  siteConfig.features.observability && siteConfig.observability.sentry;

const nextConfig: NextConfig = {
  env: {
    ACQUISITION_LEADS: String(siteConfig.acquisition.leads.enabled),
    // Build-time constants, so acquisition widgets that are off by default are tree-shaken along
    // with their client dependencies.
    ACQUISITION_ATTRIBUTION: String(siteConfig.acquisition.attribution.enabled),
    ACQUISITION_REFERRALS: String(siteConfig.acquisition.referrals.enabled),
    // Baked in at build time; instrumentation uses it to decide whether to load Sentry. When off,
    // the SDK is not included in the bundle.
    OBSERVABILITY_SENTRY: String(sentryEnabled),
  },
  // Site-wide security response headers (including CSP); the policy is in
  // src/core/security/headers.ts.
  // `/:path*` covers every path: the proxy.ts matcher excludes /api, /_next, /monitoring, and
  // static files with an extension, and those paths only pass through here.
  headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          runtimeEnv: process.env,
          isDev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

// Wraps the config with Sentry's build config only when observability.sentry is on.
function withSentry(config: NextConfig) {
  if (!sentryEnabled) return config;
  const uploadSourceMaps = canUploadSourceMaps(process.env);
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // Source maps are only uploaded when all three variables are set; after upload they are
    // deleted from the build output so they are never public.
    sourcemaps: {
      disable: !uploadSourceMaps,
      deleteSourcemapsAfterUpload: true,
    },
    widenClientFileUpload: uploadSourceMaps,
    // Browser events are relayed through this site so ad blockers drop fewer of them. The proxy.ts
    // matcher must skip this path.
    tunnelRoute: SENTRY_TUNNEL_ROUTE,
    silent: !process.env.CI,
    telemetry: false,
  });
}

// withContentCollections returns a Promise, so it must be the outermost wrapper. It generates the
// content/blog post data during dev / build.
export default withContentCollections(withSentry(withNextIntl(nextConfig)));
