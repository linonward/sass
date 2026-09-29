import { videoService } from "@/core/ai";
import { reclaimCredits } from "@/core/credits";
import { getDb } from "@/core/db";
import { notificationOutbox } from "@/core/email/queue";

import { createExceptionService } from "./service";

/**
 * Billing exceptions page: the place where money or results went wrong and a human needs to look
 * (`billing_exceptions`), plus the actions to handle them. Exceptions are opened by the code where
 * the problem happens (refund reclaim shortfall, AI task refunded as "no result", transactional
 * email out of retries); see ./open.ts.
 */
export const exceptionService = createExceptionService({
  db: getDb,
  credits: { reclaimCredits },
  video: videoService,
  outbox: notificationOutbox,
});
