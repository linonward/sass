import { z } from "zod";

// Loaded indirectly by next.config.ts, which doesn't resolve the `@/` alias, so use relative paths.
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

export const emailTransports = ["resend", "console", "file"] as const;
export type EmailTransport = (typeof emailTransports)[number];

/**
 * Valid values for `ALLOW_NON_RESEND_EMAIL`; env validation rejects anything else (0 / false are
 * the same as leaving it unset).
 */
export const nonResendEmailOptInValues = ["1", "true", "0", "false"] as const;

/**
 * Whether the explicit opt-in for "production + non-resend transport" is on: only `1` / `true`
 * count as on.
 */
function nonResendEmailOptIn(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_NON_RESEND_EMAIL;
  return value === "1" || value === "true";
}

/**
 * Whether this is a production runtime: Vercel production, or `NODE_ENV === "production"` (true
 * for `next build`, `next start`, and Docker; Vercel preview deployments are production builds
 * too).
 */
export function isProductionEmailRuntime(runtimeEnv: RuntimeEnv) {
  return (
    runtimeEnv.VERCEL_ENV === "production" ||
    runtimeEnv.NODE_ENV === "production"
  );
}

/**
 * Whether a production runtime may use a non-resend transport such as `console` / `file`.
 *
 * Not allowed by default: these two are meant for local development and tests — `console` prints
 * the whole email (sign-in verification codes are in the body) to the server log, and `file`
 * writes it to `.tmp/emails/` on disk, and neither needs an email provider key. In production that
 * leaves sign-in credentials lying around the deployment, and anyone who can see the logs or the
 * container file system could use them to sign in to someone else's account.
 *
 * Setting `ALLOW_NON_RESEND_EMAIL=1` explicitly lifts only this one check: CI's e2e runs on a
 * production build (`next start`) and reads verification codes from `.tmp/emails/`, so it needs
 * this. It does not bypass the email provider step, and it does not change how the default
 * transport is chosen.
 */
export function nonResendEmailAllowed(runtimeEnv: RuntimeEnv) {
  return (
    !isProductionEmailRuntime(runtimeEnv) || nonResendEmailOptIn(runtimeEnv)
  );
}

/**
 * Email transport: an explicitly set `EMAIL_TRANSPORT` wins; when unset, production (including
 * Vercel previews) uses resend and every other environment prints to the console.
 */
export function resolveEmailTransport(runtimeEnv: RuntimeEnv): string {
  return (
    runtimeEnv.EMAIL_TRANSPORT ||
    (runtimeEnv.NODE_ENV === "production" ? "resend" : "console")
  );
}

/**
 * Variables for the email module.
 * - `EMAIL_TRANSPORT`: defaults by NODE_ENV when unset; a production runtime only allows `resend`
 *   (see nonResendEmailAllowed), and setting `console` / `file` fails at startup.
 * - `ALLOW_NON_RESEND_EMAIL`: optional, off by default. Setting it to 1 / true explicitly allows
 *   `console` / `file` in production (CI's e2e needs it because e2e runs on a production build).
 * - `RESEND_API_KEY`: required only when the transport is resend.
 */
export function emailServerEnv(runtimeEnv: RuntimeEnv) {
  return {
    EMAIL_TRANSPORT: z
      .enum(emailTransports)
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          value === "resend" ||
          nonResendEmailAllowed(runtimeEnv),
        {
          message:
            'must be "resend" in a production runtime (VERCEL_ENV=production or NODE_ENV=production); set ALLOW_NON_RESEND_EMAIL=1 to allow console/file there',
        },
      ),
    ALLOW_NON_RESEND_EMAIL: z.enum(nonResendEmailOptInValues).optional(),
    RESEND_API_KEY: requiredWhen(
      resolveEmailTransport(runtimeEnv) === "resend",
      z.string().startsWith("re_", 'must be a Resend API key ("re_...")'),
    ),
  };
}
