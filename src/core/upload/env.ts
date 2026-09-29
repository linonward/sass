import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so relative paths only.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Variables for the upload module (Cloudflare R2).
 * - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: required in Vercel
 *   production when `features.upload` is on; optional elsewhere, in which case the upload API
 *   returns 503.
 * - `R2_PUBLIC_URL`: the bucket's public origin (e.g. https://files.example.com), only needed when
 *   `upload.public` is true.
 */
export function uploadServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled, isPublic }: { enabled: boolean; isPublic: boolean },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && enabled;
  return {
    R2_ACCOUNT_ID: requiredWhen(
      required,
      z.string().regex(/^[0-9a-f]{32}$/, "must be a 32-character account ID"),
    ),
    R2_ACCESS_KEY_ID: requiredWhen(required, z.string().min(1)),
    R2_SECRET_ACCESS_KEY: requiredWhen(required, z.string().min(1)),
    R2_BUCKET: requiredWhen(required, z.string().min(1)),
    R2_PUBLIC_URL: requiredWhen(
      required && isPublic,
      z
        .url({ protocol: /^https$/ })
        .refine((value) => !new URL(value).pathname.slice(1), {
          message: 'must be an origin such as "https://files.example.com"',
        }),
    ),
  };
}
