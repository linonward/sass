import { logger, type LogFn } from "@/core/observability/logger";

import {
  allowUnratelimited,
  isSelfHostedProduction,
  missingRedisPolicy,
  upstashConfigured,
} from "./env";
import { rateLimitingEnabled } from "./features";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Check the rate limit config at server startup, and log a prominent error
 * (`ratelimit.unconfigured`) when the production runtime has no Redis: it's the step self-hosted
 * deployments most often miss, after which AI / upload / checkout all return 503, and working
 * backward from 5xx errors to the cause is too roundabout. With `ALLOW_UNRATELIMITED` set
 * explicitly it drops to a warn — rate limiting really is off, but that's the operator's choice.
 *
 * Call it from `register()` in `instrumentation.ts` (Node runtime only: `process.env` is
 * incomplete on Edge, which would skew the check).
 *
 * Deliberately doesn't throw to abort startup: rate limiting only guards the AI / upload /
 * checkout endpoints, and taking the whole site (marketing pages, sign-in) down for them isn't
 * worth it; those endpoints return 503 themselves and the log explains why.
 */
export function warnIfRateLimitUnconfigured({
  runtimeEnv = process.env,
  log = logger,
}: {
  runtimeEnv?: RuntimeEnv;
  log?: { warn: LogFn; error: LogFn };
} = {}) {
  if (!rateLimitingEnabled() || upstashConfigured(runtimeEnv)) return;

  const missing = "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set";
  const fix =
    "set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set ALLOW_UNRATELIMITED=1 to run without rate limiting";

  if (missingRedisPolicy(runtimeEnv, { enabled: true }) === "unavailable") {
    log.error("ratelimit.unconfigured", {
      reason: missing,
      effect:
        "AI, upload and checkout endpoints return 503 until Redis is configured",
      fix,
    });
    return;
  }

  // ALLOW_UNRATELIMITED set explicitly in a production runtime: letting requests through is
  // intentional, but rate limiting really isn't running.
  if (isSelfHostedProduction(runtimeEnv) && allowUnratelimited(runtimeEnv)) {
    log.warn("ratelimit.disabled", { reason: "ALLOW_UNRATELIMITED is set" });
  }
}
