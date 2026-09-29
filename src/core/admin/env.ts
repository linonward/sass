import { z } from "zod";

// Loaded indirectly by next.config.ts, which does not resolve the `@/` alias, so relative paths only.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** A comma-separated list of emails, trimmed and lowercased. */
export const adminEmailsSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email("must be comma-separated email addresses")).min(1));

/**
 * Variables for the admin module.
 * - `ADMIN_EMAILS`: comma-separated emails. Signing in with one of them (email verified)
 *   automatically grants the admin role. Required in Vercel production when `features.admin` is
 *   on, otherwise nobody can get into the admin panel.
 */
export function adminServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
) {
  return {
    ADMIN_EMAILS: requiredWhen(
      enabled && runtimeEnv.VERCEL_ENV === "production",
      adminEmailsSchema,
    ),
  };
}
