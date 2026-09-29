import {
  and,
  asc,
  eq,
  inArray,
  lt,
  lte,
  or,
  isNull,
  gt,
  sql,
} from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import {
  pendingNotifications,
  type PendingNotification,
} from "@/core/db/schema";
import { openException } from "@/core/exceptions/open";
import { logger, type LogFn } from "@/core/observability/logger";

import { releaseNotificationClaim } from "./notification-log";
import { isSealed, openProps, sealProps } from "./sealed-props";
import type { SendEmailOptions } from "./send";
import type { EmailTemplateName } from "./templates";
import type { SendOptions } from "./transports";

type Executor = Database | DbTransaction;
export type DatabaseSource = Database | (() => Database);

/** 一行最多尝试发送的次数（含提交后立即发送的那几次）。用完记终态 failed。 */
export const OUTBOX_MAX_ATTEMPTS = 8;

/**
 * 立即发送失败之后，第 n 次补发前等多久。扫描多久跑一次由部署决定（见 README「恢复扫描」），
 * 这里只是「最早什么时候可以再试」。累计约 7 小时：覆盖服务商一次像样的故障，
 * 又不至于隔天才收到付款成功。
 */
const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
];

/** `sending` 超过这么久还没结论：发送的进程多半死了，放回 pending 让扫描接手。 */
export const OUTBOX_SENDING_STALE_MS = 10 * 60 * 1000;

/** 提交后立即发送时的快速重试（覆盖服务商的瞬时故障）；和原来进程内重试的参数一致。 */
export type DeliveryRetry = { attempts?: number; delayMs?: number };
const DEFAULT_BURST = 3;
const DEFAULT_BURST_DELAY_MS = 500;
const MAX_BURST_DELAY_MS = 5_000;

export type OutboxSend = (
  options: SendEmailOptions<EmailTemplateName>,
  sendOptions: SendOptions,
) => Promise<unknown>;

export type EnqueueInput = {
  kind: string;
  key: string;
  userId?: string | null;
  to: string;
  template: EmailTemplateName;
  props: Record<string, unknown>;
  locale: string;
  /** 敏感参数（验证码）：加密存放，发出或作废后清空。需要 outbox 配了 `secret`。 */
  sensitive?: boolean;
  /** 过了这个时间就不再发。 */
  expiresAt?: Date;
  /** 占 notification_log 名额时的时间；终态失败时凭它释放名额。没有名额时不传。 */
  claimedAt?: Date;
  /** 同一 (kind, key) 还没发出的旧行作废（新验证码取代旧验证码）。 */
  supersede?: boolean;
};

export type DeliveryOutcome = "sent" | "retry" | "failed" | "skipped";

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 事务邮件的 outbox。
 *
 * 流程：业务事务里 `enqueue`（和去重名额、业务写入一起提交或回滚）→ 提交后 `deliver`
 * 立即发一次（带几次快速重试）→ 还没发出去就留在库里，`scan` 按退避补发 → 重试用完记终态
 * `failed` 并保留，释放去重名额、开一张 `notification_failed` 异常单，后台可以人工补发。
 *
 * 同一行只发一次靠两层：
 * 1. 发送前用状态转换抢占（pending → sending 的条件更新），并发的扫描 / 立即发送只有一个抢到；
 * 2. 发送时带幂等键 `notification/<行 id>`（Resend 的 Idempotency-Key，保留 24 小时）：
 *    进程在「服务商已收下、我们还没记成 sent」之间死掉，扫描把行从 sending 放回 pending 再发时，
 *    服务商认得出是同一封，不会投递第二次。
 */
export function createOutbox({
  db,
  send,
  secret,
  retry,
  now = () => new Date(),
  logError = logger.error,
}: {
  db: DatabaseSource;
  send: OutboxSend;
  /** 加密敏感参数的密钥（BETTER_AUTH_SECRET）。 */
  secret?: string;
  retry?: DeliveryRetry;
  now?: () => Date;
  logError?: LogFn;
}) {
  const getDb = () => (typeof db === "function" ? db() : db);
  const burst = Math.max(1, Math.trunc(retry?.attempts ?? DEFAULT_BURST));
  const burstDelay = Math.max(0, retry?.delayMs ?? DEFAULT_BURST_DELAY_MS);

  async function enqueue(executor: Executor, input: EnqueueInput) {
    if (input.sensitive && !secret) {
      throw new Error("outbox: sensitive notifications need a secret");
    }
    if (input.supersede) {
      await executor
        .update(pendingNotifications)
        .set({
          status: "failed",
          lastError: "superseded",
          props: {},
          updatedAt: now(),
        })
        .where(
          and(
            eq(pendingNotifications.kind, input.kind),
            eq(pendingNotifications.key, input.key),
            eq(pendingNotifications.status, "pending"),
          ),
        );
    }
    const [row] = await executor
      .insert(pendingNotifications)
      .values({
        kind: input.kind,
        key: input.key,
        userId: input.userId ?? null,
        to: input.to,
        template: input.template,
        props: input.sensitive ? sealProps(input.props, secret!) : input.props,
        locale: input.locale,
        expiresAt: input.expiresAt ?? null,
        claimedAt: input.claimedAt ?? null,
        nextRetryAt: now(),
      })
      .returning({ id: pendingNotifications.id });
    return row!.id;
  }

  /** 终态失败：保留行（敏感参数清空），释放去重名额，非敏感的开一张可补发的异常单。 */
  async function fail(
    row: PendingNotification,
    attempts: number,
    error: string,
  ) {
    const sealed = isSealed(row.props);
    await getDb()
      .update(pendingNotifications)
      .set({
        status: "failed",
        attempts,
        lastError: error,
        ...(sealed ? { props: {} } : {}),
        updatedAt: now(),
      })
      .where(eq(pendingNotifications.id, row.id));
    if (row.claimedAt) {
      try {
        await releaseNotificationClaim(getDb(), {
          kind: row.kind,
          key: row.key,
          now: row.claimedAt,
        });
      } catch (releaseError) {
        logError("email.claim_release_failed", {
          kind: row.kind,
          key: row.key,
          error: releaseError,
        });
      }
    }
    // 验证码过期 / 被取代没有补发的意义，不开单；其它关键邮件开单等人补发。
    if (!sealed && row.userId) {
      try {
        await openException(getDb(), {
          kind: "notification_failed",
          userId: row.userId,
          source: "pending_notifications",
          sourceId: row.id,
          detail: {
            notificationId: row.id,
            template: row.template,
            to: row.to,
            kind: row.kind,
            key: row.key,
          },
          lastError: error,
          bump: true,
        });
      } catch (openError) {
        logError("email.exception_open_failed", {
          error: openError,
          id: row.id,
        });
      }
    }
    logError("email.delivery_failed", {
      id: row.id,
      kind: row.kind,
      key: row.key,
      attempts,
      error,
    });
  }

  /**
   * 发一行：抢到了就发（带快速重试），然后记成 sent、排下一次重试，或者记终态失败。
   * 没抢到（别人在发、还没到重试时间、已过期、已发完）返回 `skipped`。从不抛错。
   */
  async function deliver(id: string): Promise<DeliveryOutcome> {
    const at = now();
    const [row] = await getDb()
      .update(pendingNotifications)
      .set({ status: "sending", updatedAt: at })
      .where(
        and(
          eq(pendingNotifications.id, id),
          eq(pendingNotifications.status, "pending"),
          lte(pendingNotifications.nextRetryAt, at),
          or(
            isNull(pendingNotifications.expiresAt),
            gt(pendingNotifications.expiresAt, at),
          ),
        ),
      )
      .returning();
    if (!row) return "skipped";

    let props: Record<string, unknown>;
    try {
      props = isSealed(row.props)
        ? openProps(row.props, secret ?? "")
        : row.props;
    } catch (error) {
      await fail(row, row.attempts, `cannot decrypt props: ${message(error)}`);
      return "failed";
    }

    let lastError = "";
    let tries = 0;
    for (; tries < burst;) {
      tries += 1;
      try {
        await send(
          {
            to: row.to,
            template: row.template as EmailTemplateName,
            props: props as never,
            locale: row.locale,
          },
          { idempotencyKey: `notification/${row.id}` },
        );
        await getDb()
          .update(pendingNotifications)
          .set({
            status: "sent",
            attempts: row.attempts + tries,
            lastError: null,
            sentAt: now(),
            updatedAt: now(),
            // 验证码发出去之后原文没有留着的理由。
            ...(isSealed(row.props) ? { props: {} } : {}),
          })
          .where(eq(pendingNotifications.id, row.id));
        return "sent";
      } catch (error) {
        lastError = message(error);
        if (tries < burst) {
          logger.warn("email.delivery_retry", {
            id: row.id,
            kind: row.kind,
            attempt: row.attempts + tries,
            error,
          });
          await sleep(
            Math.min(burstDelay * 2 ** (tries - 1), MAX_BURST_DELAY_MS),
          );
        }
      }
    }

    const attempts = row.attempts + tries;
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    const next = new Date(now().getTime() + wait);
    const expired = row.expiresAt !== null && row.expiresAt <= next;
    if (attempts >= OUTBOX_MAX_ATTEMPTS || expired) {
      await fail(
        row,
        attempts,
        expired ? `expired after: ${lastError}` : lastError,
      );
      return "failed";
    }
    await getDb()
      .update(pendingNotifications)
      .set({
        status: "pending",
        attempts,
        lastError,
        nextRetryAt: next,
        updatedAt: now(),
      })
      .where(eq(pendingNotifications.id, row.id));
    logger.warn("email.delivery_deferred", {
      id: row.id,
      kind: row.kind,
      attempts,
      nextRetryAt: next.toISOString(),
      error: lastError,
    });
    return "retry";
  }

  /**
   * 补发扫描（恢复入口调用）：
   * 1. 卡在 sending 太久的放回 pending（发送进程死了）；
   * 2. 过期还没发的记终态失败（验证码过了有效期，发出去也没用）；
   * 3. 到了重试时间的按顺序发，最多 `limit` 行。
   * 重复扫描是安全的：每一行都要先抢占才会发。
   */
  async function scan({
    limit = 20,
    userIds,
  }: {
    limit?: number;
    /** 只扫这些用户的行（测试隔离用）；不传扫全部。 */
    userIds?: string[];
  } = {}) {
    const at = now();
    const scope = userIds
      ? inArray(pendingNotifications.userId, userIds)
      : undefined;

    const reset = await getDb()
      .update(pendingNotifications)
      .set({ status: "pending", updatedAt: at })
      .where(
        and(
          scope,
          eq(pendingNotifications.status, "sending"),
          lt(
            pendingNotifications.updatedAt,
            new Date(at.getTime() - OUTBOX_SENDING_STALE_MS),
          ),
        ),
      )
      .returning({ id: pendingNotifications.id });

    const expired = await getDb()
      .update(pendingNotifications)
      .set({
        status: "failed",
        lastError: sql`coalesce(${pendingNotifications.lastError} || ' / ', '') || 'expired'`,
        props: {},
        updatedAt: at,
      })
      .where(
        and(
          scope,
          eq(pendingNotifications.status, "pending"),
          lte(pendingNotifications.expiresAt, at),
        ),
      )
      .returning({ id: pendingNotifications.id });

    const due = await getDb()
      .select({ id: pendingNotifications.id })
      .from(pendingNotifications)
      .where(
        and(
          scope,
          eq(pendingNotifications.status, "pending"),
          lte(pendingNotifications.nextRetryAt, at),
        ),
      )
      .orderBy(asc(pendingNotifications.nextRetryAt))
      .limit(limit);

    const counts = {
      due: due.length,
      sent: 0,
      retry: 0,
      failed: 0,
      skipped: 0,
    };
    for (const { id } of due) counts[await deliver(id)] += 1;
    return { ...counts, reset: reset.length, expired: expired.length };
  }

  /**
   * 人工补发一封终态失败的邮件（后台异常台调用）：重新放回队列、尝试次数清零，立即发一次。
   * 敏感参数已经清空的行（验证码）补发不了，返回 `skipped`。
   */
  async function resend(id: string): Promise<DeliveryOutcome> {
    const [row] = await getDb()
      .update(pendingNotifications)
      .set({
        status: "pending",
        attempts: 0,
        lastError: null,
        nextRetryAt: now(),
        updatedAt: now(),
      })
      .where(
        and(
          eq(pendingNotifications.id, id),
          eq(pendingNotifications.status, "failed"),
          sql`${pendingNotifications.props} <> '{}'::jsonb`,
          or(
            isNull(pendingNotifications.expiresAt),
            gt(pendingNotifications.expiresAt, now()),
          ),
        ),
      )
      .returning({ id: pendingNotifications.id });
    if (!row) return "skipped";
    return deliver(row.id);
  }

  return { enqueue, deliver, scan, resend };
}

export type Outbox = ReturnType<typeof createOutbox>;
