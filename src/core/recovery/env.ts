import { z } from "zod";

/**
 * Variables for the recovery endpoint (`/api/cron/recovery`).
 * - `CRON_SECRET`: callers must send `Authorization: Bearer <CRON_SECRET>`. Vercel cron adds this
 *   header automatically; a self-hosted scheduler adds it itself when it curls. When unset, the
 *   endpoint always returns 404 — an explicit refusal, never a silent pass. Leaving it unset does
 *   not break the site: the recovery sweep still runs opportunistically when users use AI features
 *   (see ./index.ts).
 */
export function recoveryServerEnv() {
  return {
    CRON_SECRET: z
      .string()
      .min(16, "must be at least 16 characters (openssl rand -hex 32)")
      .optional(),
  };
}
