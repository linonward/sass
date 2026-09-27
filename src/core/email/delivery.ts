import type { Database } from "@/core/db/client";
import { logger } from "@/core/observability/logger";

import { releaseNotificationClaim } from "./notification-log";

/** 释放名额用的数据库；传函数时延迟到真正需要时再取连接（和 createCredits 一致）。 */
export type DatabaseSource = Database | (() => Database);

/** 发送失败时的重试参数。默认 3 次、500ms 起指数退避（最多 5s 一次）。 */
export type DeliveryRetry = {
  attempts?: number;
  delayMs?: number;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 生成「事务提交后投递通知邮件」的回调：名额（claim）已经在事务里占好，这里只负责发送，
 * 并让失败可以被重试。
 *
 * - 发送失败先重试（默认 3 次、500ms 起指数退避），覆盖服务商的瞬时故障（5xx、网络抖动）；
 * - 重试都失败后**释放名额**，之后同 key 的尝试（服务商重放同一事件、人工补发、下一个窗口）
 *   能重新占用名额并真发出这封邮件 —— 原来的 at-most-once 下，一次失败会让这封邮件
 *   永远发不出去；
 * - 释放后仍然把原始错误抛给调用方（runAfterCommit / runAfterResponse 会记日志），
 *   webhook 的结果不受影响。
 *
 * 代价是 at-least-once：如果服务商其实已经收下、只是我们没读到响应（超时），重试会重复一封。
 * 对「付款成功」这类关键邮件，重复一封远好于永远不发。正常路径（第一发就成功）不变：
 * 名额不释放，同一 (kind, key) 在窗口内仍然只发一次。
 */
export function createNotificationDelivery({
  db,
  kind,
  key,
  now,
  send,
  retry,
}: {
  db: DatabaseSource;
  kind: string;
  /** 和占名额时用的 key 一致：释放名额时用它定位这一行。 */
  key: string;
  /** 占名额时传给 claimNotification 的时间；释放名额时用它确认这行还是这次尝试留下的。 */
  now: Date;
  send: () => Promise<unknown>;
  retry?: DeliveryRetry;
}): () => Promise<void> {
  const attempts = Math.max(1, Math.trunc(retry?.attempts ?? DEFAULT_ATTEMPTS));
  const baseDelay = Math.max(0, retry?.delayMs ?? DEFAULT_DELAY_MS);

  return async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await send();
        return;
      } catch (error) {
        if (attempt < attempts) {
          logger.warn("email.delivery_retry", { kind, key, attempt, error });
          await sleep(Math.min(baseDelay * 2 ** (attempt - 1), MAX_DELAY_MS));
          continue;
        }

        // 重试都用完了：释放名额。释放本身失败（例如数据库不可用）不能让原始的发送错误
        // 消失 —— 名额留着只是回到 at-most-once，记下来即可，错误照旧抛给调用方。
        const executor = typeof db === "function" ? db() : db;
        let released = false;
        try {
          released = await releaseNotificationClaim(executor, {
            kind,
            key,
            now,
          });
        } catch (releaseError) {
          logger.error("email.claim_release_failed", {
            kind,
            key,
            error: releaseError,
          });
        }
        logger.error("email.delivery_failed", {
          kind,
          key,
          attempts,
          released,
          error,
        });
        throw error;
      }
    }
  };
}
