import siteConfig from "../../../site.config";

/**
 * Whether rate limiting is in use: `features.rateLimit` itself, or any module that calls the rate
 * limiter (AI, upload, leads, API key per-key limits).
 *
 * `src/core/env.ts` (which decides whether to require the Upstash variables), the rate limit
 * wiring, and the startup check all use it so their checks can't drift apart — missing one would
 * mean the variables are required as if it's on while the runtime treats it as off.
 */
export function rateLimitingEnabled() {
  const { features, acquisition, apiKeys } = siteConfig;
  return (
    features.rateLimit ||
    features.ai ||
    features.upload ||
    acquisition.leads.enabled ||
    // A per-key threshold means rate limiting is really in use, so it needs the Upstash variables
    // too.
    apiKeys.rateLimitPerKey !== undefined
  );
}
