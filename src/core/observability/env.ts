import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so use relative paths.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Sentry build-time variables, used only to upload source maps (uploaded only when all three are
 * set). Leaving them empty doesn't affect error reporting.
 * - `SENTRY_AUTH_TOKEN`: a Sentry Organization Auth Token.
 * - `SENTRY_ORG` / `SENTRY_PROJECT`: the organization and project slugs.
 */
export function observabilityServerEnv() {
  return {
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
  };
}

/**
 * Variables the browser needs too.
 * - `NEXT_PUBLIC_SENTRY_DSN`: the Sentry project's DSN; required when `observability.sentry` is on.
 */
export function observabilityClientEnv({ sentry }: { sentry: boolean }) {
  return {
    NEXT_PUBLIC_SENTRY_DSN: requiredWhen(
      sentry,
      z.url({ protocol: /^https?$/ }),
    ),
  };
}

/** Source maps are uploaded only when all three are set. */
export function canUploadSourceMaps(runtimeEnv: RuntimeEnv) {
  return Boolean(
    runtimeEnv.SENTRY_AUTH_TOKEN &&
    runtimeEnv.SENTRY_ORG &&
    runtimeEnv.SENTRY_PROJECT,
  );
}
