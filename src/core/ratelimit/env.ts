import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so use relative paths.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Valid values for `ALLOW_UNRATELIMITED`; env validation rejects anything else (0 / false are the
 * same as leaving it unset).
 */
export const allowUnratelimitedValues = ["1", "true", "0", "false"] as const;

/**
 * Whether this is "self-hosted production": `NODE_ENV === "production"` and not on Vercel
 * (`next build` / `next start` / Docker).
 *
 * Vercel deployments, production or preview, always have `VERCEL_ENV`, so they don't count as
 * self-hosted: there, production gets the Upstash variables enforced by `rateLimitServerEnv` below,
 * and previews skip rate limiting just like local development.
 */
export function isSelfHostedProduction(runtimeEnv: RuntimeEnv) {
  return !runtimeEnv.VERCEL_ENV && runtimeEnv.NODE_ENV === "production";
}

/**
 * Whether the explicit opt-out for "production runtime without Redis" is on: only `1` / `true`
 * count as on.
 */
export function allowUnratelimited(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_UNRATELIMITED;
  return value === "1" || value === "true";
}

/** Whether Redis is fully configured (both variables required; only one, or empty strings, count as unset). */
export function upstashConfigured(runtimeEnv: RuntimeEnv) {
  return Boolean(
    runtimeEnv.UPSTASH_REDIS_REST_URL && runtimeEnv.UPSTASH_REDIS_REST_TOKEN,
  );
}

/**
 * What to do when Redis is not configured (`upstashConfigured` decides whether it is; this only
 * picks the policy):
 * - `"allow"`: let requests through. Local, tests, CI, Vercel previews, or `ALLOW_UNRATELIMITED`
 *   set explicitly.
 * - `"unavailable"`: reject requests (503). Self-hosted production with the variables missing —
 *   there's no platform-side variable validation as a backstop, and silently letting requests
 *   through would switch off rate limiting for AI / upload / checkout entirely, leaving only a
 *   single warn log line that's easy to miss.
 *
 * Vercel production also returns `"unavailable"`, but that path is unreachable: the schema below
 * requires the variables, so the app won't start without them.
 */
export function missingRedisPolicy(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
): "allow" | "unavailable" {
  if (!enabled || allowUnratelimited(runtimeEnv)) return "allow";
  const required =
    runtimeEnv.VERCEL_ENV === "production" ||
    isSelfHostedProduction(runtimeEnv);
  return required ? "unavailable" : "allow";
}

/**
 * Variables for the rate limit module (the Upstash Redis REST URL and token). Required when
 * `required` is true (Vercel production with ai, upload, or rateLimit enabled); optional
 * elsewhere, in which case rate limiting is skipped — except that self-hosted production rejects
 * requests (see `missingRedisPolicy`). Local, tests, CI, and Vercel previews let requests through
 * as usual, and `ALLOW_UNRATELIMITED` explicitly lets self-hosted production through.
 */
export function rateLimitServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && enabled;
  return {
    UPSTASH_REDIS_REST_URL: requiredWhen(
      required,
      z.url({ protocol: /^https$/ }),
    ),
    UPSTASH_REDIS_REST_TOKEN: requiredWhen(required, z.string().min(1)),
    ALLOW_UNRATELIMITED: z.enum(allowUnratelimitedValues).optional(),
  };
}
