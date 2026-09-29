import { aiRecovery } from "@/core/ai";
import { getDb } from "@/core/db";
import { notificationOutbox } from "@/core/email/queue";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";

import { createRecoveryRunner } from "./run";

export { handleCronRecovery } from "./handler";

/**
 * Recovery: drives background state that nothing else is advancing to a terminal state — stuck AI
 * tasks and transactional emails that never went out.
 *
 * How often it fires depends on the deployment; the entry points are decoupled from the frequency:
 * - platform cron / self-hosted scheduler → `GET /api/cron/recovery` (with CRON_SECRET), up to 20
 *   items per run;
 * - opportunistic: when a user uses an AI feature, one run piggybacks after the response (skipped
 *   if the last one was less than 5 minutes ago), up to 3 items per run.
 * Both paths share one database lease, so they never run at the same time.
 */
export const runRecovery = createRecoveryRunner({
  db: getDb,
  tasks: {
    ai: (options) => aiRecovery(options),
    notifications: (options) => notificationOutbox.scan(options),
  },
});

/**
 * Items per cron run: the endpoint's maxDuration is 300 seconds, and copying one video to storage
 * usually takes a few seconds.
 */
export const CRON_RECOVERY_LIMIT = 20;

/**
 * Items per opportunistic sweep: it runs inside the user request's after(), so it eats into that
 * function's duration.
 */
export const OPPORTUNISTIC_RECOVERY_LIMIT = 3;

/**
 * Within one instance, ask the database "should we sweep?" at most once per 60 seconds: the video
 * status endpoint is polled every few seconds, and we can't try to grab the lease on every poll. The
 * real rate limit (5 minutes) and mutual exclusion live in the database lease.
 */
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;
let lastLocalCheck = 0;

/**
 * Runs one bounded recovery sweep after the current request's response (only when it is due). Never
 * throws and never slows the response. Call it from AI-related endpoints: a user using an AI feature
 * means the site has traffic and is the most likely to have stuck tasks.
 */
export function scheduleOpportunisticRecovery() {
  const now = Date.now();
  if (now - lastLocalCheck < LOCAL_CHECK_INTERVAL_MS) return;
  lastLocalCheck = now;
  void runAfterResponse(async () => {
    try {
      await runRecovery({
        trigger: "opportunistic",
        limit: OPPORTUNISTIC_RECOVERY_LIMIT,
      });
    } catch (error) {
      logger.error("recovery.opportunistic_failed", { error });
    }
  });
}
