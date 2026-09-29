import { videoService } from "@/core/ai";
import { reclaimCredits } from "@/core/credits";
import { getDb } from "@/core/db";
import { notificationOutbox } from "@/core/email/queue";

import { createExceptionService } from "./service";

/**
 * 计费异常台：钱或结果出问题、需要有人看的地方（`billing_exceptions`），以及处理动作。
 * 开单的地方在出问题的代码里（退款回收差额、AI 任务按「无结果」退款、事务邮件重试用完），见 ./open.ts。
 */
export const exceptionService = createExceptionService({
  db: getDb,
  credits: { reclaimCredits },
  video: videoService,
  outbox: notificationOutbox,
});
