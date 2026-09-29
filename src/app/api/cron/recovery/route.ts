import { env } from "@/core/env";
import {
  CRON_RECOVERY_LIMIT,
  handleCronRecovery,
  runRecovery,
} from "@/core/recovery";

// Advances at most CRON_RECOVERY_LIMIT jobs per run, and videos must be downloaded and re-stored;
// maximum function duration on Vercel (seconds).
export const maxDuration = 300;

/**
 * Recovery sweep entry point: called by Vercel cron (`crons` in vercel.json) or any scheduler with
 * `Authorization: Bearer $CRON_SECRET`. Returns 404 when CRON_SECRET is not set.
 */
export async function GET(request: Request) {
  return handleCronRecovery(request, {
    secret: env.CRON_SECRET,
    run: () => runRecovery({ trigger: "cron", limit: CRON_RECOVERY_LIMIT }),
  });
}
