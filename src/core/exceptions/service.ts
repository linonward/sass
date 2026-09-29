import { eq, sql } from "drizzle-orm";

import type { VideoTaskStatus } from "@/core/ai/alibaba-video";
import {
  owedForOrder,
  REFUND_RECLAIM_SOURCE,
  retryReclaimSourceId,
} from "@/core/billing/reclaim-credits";
import type { Credits } from "@/core/credits";
import type { Database, DbTransaction } from "@/core/db/client";
import { adminActions, aiUsage, billingExceptions } from "@/core/db/schema";

/** 审计表里异常单的 target_kind。 */
export const EXCEPTION_TARGET = "billing_exception";

export type ExceptionActionName =
  "resend" | "retry_reclaim" | "recheck" | "resolve" | "ignore";

/**
 * 一次处理动作的结果。`result` 是写进审计表的机读结果（也在后台的处理历史里显示）：
 * - 重试回收：`reclaimed:<n>`（扣够了，关单）/ `partial:<n>/<owed>`（还不够）/
 *   `uncollectible:<owed>`（余额为 0）/ `nothing_owed`（账上已不欠，关单）/ `order_missing`；
 * - 重新核对：`recovered:<状态>`（任务还在 pending，按恢复路径推进）/ `provider:<状态>`（任务已结束，
 *   只记下服务商现在怎么说）/ `provider_unavailable` / `provider_error`；
 * - 补发邮件：`sent`（发出去了，关单）/ `retry` / `failed`（又没发出去，单子留着）/
 *   `skipped`（这封已经补发不了，比如验证码的原文已清掉）；
 * - 标记处理 / 忽略：`resolved` / `ignored`。
 * `closed` 表示这次动作之后单子不再是 open。
 */
export type ExceptionActionOutcome =
  | { ok: true; result: string; closed: boolean }
  | { ok: false; error: "not_found" | "not_open" | "wrong_kind" };

export type ExceptionServiceDeps = {
  db: () => Database;
  credits: Pick<Credits, "reclaimCredits">;
  video: {
    recoverVideo: (id: string) => Promise<{ status: string } | null>;
    providerStatus: (id: string) => Promise<VideoTaskStatus | null>;
  };
  /** 事务邮件的 outbox：终态失败的邮件在这里补发（见 @/core/email/outbox）。 */
  outbox: {
    resend: (id: string) => Promise<"sent" | "retry" | "failed" | "skipped">;
  };
};

type ActionInput = { actorId: string; exceptionId: string; reason: string };

/**
 * 异常台的处理动作。每个动作：
 * - 只处理 open 的单子（已处理的返回 `not_open`，不重复做任何事）；
 * - 复用已有的幂等路径，不新写金额逻辑（回收走 `reclaimCredits`，AI 任务走恢复扫描的结算路径）；
 * - 在 `admin_actions` 里记一行：谁、什么时候、对哪张单、做了什么、为什么、结果如何。
 *
 * 权限不在这里判断 —— 调用方（Server Action）先验管理员身份。
 */
export function createExceptionService({
  db,
  credits,
  video,
  outbox,
}: ExceptionServiceDeps) {
  async function audit(
    executor: Database | DbTransaction,
    { actorId, exceptionId, reason }: ActionInput,
    action: ExceptionActionName,
    result: string,
  ) {
    await executor.insert(adminActions).values({
      actorId,
      action,
      targetKind: EXCEPTION_TARGET,
      targetId: exceptionId,
      reason,
      result,
    });
  }

  async function load(id: string) {
    const [row] = await db()
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, id));
    return row;
  }

  /** 事务里锁住单子再判断状态：并发的两次动作只有一次看到 open。 */
  async function lock(tx: DbTransaction, id: string) {
    const [row] = await tx
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, id))
      .for("update");
    return row;
  }

  function close(
    tx: DbTransaction,
    id: string,
    status: "resolved" | "ignored",
    resolution: string,
  ) {
    return tx
      .update(billingExceptions)
      .set({
        status,
        resolution,
        resolvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(billingExceptions.id, id));
  }

  function recordAttempt(
    executor: Database | DbTransaction,
    id: string,
    lastError: string | null,
    detail: Record<string, unknown>,
  ) {
    return executor
      .update(billingExceptions)
      .set({
        attempts: sql`${billingExceptions.attempts} + 1`,
        lastError,
        detail: sql`${billingExceptions.detail} || ${JSON.stringify(detail)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(eq(billingExceptions.id, id));
  }

  /**
   * 重试回收：锁住订单行，按账本重算这个订单**现在**还欠多少，欠多少扣多少。
   *
   * 防重复扣款靠的是「锁 + 重算」，不是新的幂等键：两次并发的重试里，后到的那次在订单行锁上
   * 等前一次提交，再重算时已回收的积分里已经包含了前一次扣的，欠款变小或归零，不会多扣。
   * 写流水用的 sourceId 挂在同一订单的 `:refund:` 前缀下（`retryReclaimSourceId`），
   * 所以它和 webhook 的回收共用一个「已回收」口径；带上尝试次数，同一次尝试重复提交撞唯一键。
   *
   * 锁的顺序和 webhook 回收一致：先订单，后异常单 —— 两边不会互相等死。
   */
  async function retryReclaim(
    input: ActionInput,
  ): Promise<ExceptionActionOutcome> {
    const found = await load(input.exceptionId);
    if (!found) return { ok: false, error: "not_found" };
    if (found.kind !== "refund_reclaim_shortfall") {
      return { ok: false, error: "wrong_kind" };
    }
    const provider = String(found.detail.provider ?? "");
    const orderId = String(found.detail.orderId ?? "");

    return db().transaction(async (tx): Promise<ExceptionActionOutcome> => {
      const owed =
        provider && orderId
          ? await owedForOrder(tx, { provider, orderId, userId: found.userId })
          : null;
      const row = await lock(tx, found.id);
      if (!row || row.status !== "open")
        return { ok: false, error: "not_open" };

      let result: string;
      let closed = false;
      if (!owed) {
        result = "order_missing";
        await recordAttempt(tx, row.id, "order or credit grant not found", {});
      } else if (owed.owed <= 0) {
        // 账上已经不欠了（比如同一订单后来的退款回收已经补齐）：关单，理由用管理员写的。
        result = "nothing_owed";
        closed = true;
        await close(tx, row.id, "resolved", input.reason);
      } else {
        const attempt = row.attempts + 1;
        const reclaimed = await credits.reclaimCredits(
          {
            userId: row.userId,
            amount: owed.owed,
            source: REFUND_RECLAIM_SOURCE,
            sourceId: retryReclaimSourceId(provider, orderId, row.id, attempt),
            reason: `Retry reclaim of ${provider} order ${orderId}`,
          },
          { tx },
        );
        if (reclaimed.status === "uncollectible") {
          result = `uncollectible:${owed.owed}`;
        } else if (reclaimed.shortfall > 0) {
          result = `partial:${reclaimed.reclaimed}/${owed.owed}`;
        } else {
          result = `reclaimed:${reclaimed.reclaimed}`;
          closed = true;
        }
        const detail = {
          shortfall: reclaimed.shortfall,
          balance: reclaimed.balance,
          lastReclaimed: reclaimed.reclaimed,
        };
        if (closed) {
          await tx
            .update(billingExceptions)
            .set({
              attempts: attempt,
              detail: sql`${billingExceptions.detail} || ${JSON.stringify(detail)}::jsonb`,
            })
            .where(eq(billingExceptions.id, row.id));
          await close(tx, row.id, "resolved", input.reason);
        } else {
          await recordAttempt(
            tx,
            row.id,
            `balance insufficient: owed ${owed.owed}, reclaimed ${reclaimed.reclaimed}, balance ${reclaimed.balance}`,
            detail,
          );
        }
      }
      await audit(tx, input, "retry_reclaim", result);
      return { ok: true, result, closed };
    });
  }

  /**
   * 重新核对 AI 任务：
   * - 任务还是 pending：交给恢复扫描的同一条路径推进（先问服务商，有结果先保存）；
   *   推进到终态就关单（理由用管理员写的），还在等就留着；
   * - 任务已经结束（按「无结果」退了款）：只问服务商现在怎么说，记进单子，不动钱 ——
   *   服务商后来成功了要追回还是补发，由人决定，然后「标记已处理」。
   */
  async function recheck(input: ActionInput): Promise<ExceptionActionOutcome> {
    const found = await load(input.exceptionId);
    if (!found) return { ok: false, error: "not_found" };
    if (found.kind !== "ai_job_needs_review") {
      return { ok: false, error: "wrong_kind" };
    }
    if (found.status !== "open") return { ok: false, error: "not_open" };

    const [usage] = await db()
      .select({ status: aiUsage.status })
      .from(aiUsage)
      .where(eq(aiUsage.id, found.sourceId));

    let result: string;
    let detail: Record<string, unknown>;
    let lastError: string | null = null;
    let settled = false;
    try {
      if (usage?.status === "pending") {
        const job = await video.recoverVideo(found.sourceId);
        result = `recovered:${job?.status ?? "missing"}`;
        settled = job?.status !== "pending";
        detail = { recheckedStatus: job?.status ?? null };
        if (!settled) lastError = "provider still has no result";
      } else {
        const status = await video.providerStatus(found.sourceId);
        result = status ? `provider:${status.status}` : "provider_unavailable";
        detail = {
          providerStatus: status?.status ?? null,
          providerError: status?.status === "failed" ? status.error : null,
        };
        if (!status) lastError = "no provider task to check";
      }
    } catch (error) {
      result = "provider_error";
      lastError = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 1000);
      detail = {};
    }

    return db().transaction(async (tx): Promise<ExceptionActionOutcome> => {
      const row = await lock(tx, found.id);
      if (!row || row.status !== "open")
        return { ok: false, error: "not_open" };
      if (settled) {
        await tx
          .update(billingExceptions)
          .set({
            attempts: sql`${billingExceptions.attempts} + 1`,
            detail: sql`${billingExceptions.detail} || ${JSON.stringify(detail)}::jsonb`,
          })
          .where(eq(billingExceptions.id, row.id));
        await close(tx, row.id, "resolved", input.reason);
      } else {
        // 核对拿到了服务商状态（lastError 为 null）时顺带清掉上一次的错误信息。
        await recordAttempt(tx, row.id, lastError, detail);
      }
      await audit(tx, input, "recheck", result);
      return { ok: true, result, closed: settled };
    });
  }

  /**
   * 补发一封终态失败的邮件：outbox 里那一行放回队列立即发一次。发出去就关单；
   * 又没发出去，单子留着（outbox 会按退避继续补发，再次用完时更新这张单的次数和错误）。
   * 注意这是 at-least-once：终态失败时去重名额已经释放，期间如果同一事件又触发过一封，
   * 补发会多出一封 —— 所以要人来按，并写理由。
   */
  async function resendNotification(
    input: ActionInput,
  ): Promise<ExceptionActionOutcome> {
    const found = await load(input.exceptionId);
    if (!found) return { ok: false, error: "not_found" };
    if (found.kind !== "notification_failed") {
      return { ok: false, error: "wrong_kind" };
    }
    if (found.status !== "open") return { ok: false, error: "not_open" };

    const result = await outbox.resend(found.sourceId);
    const sent = result === "sent";
    return db().transaction(async (tx): Promise<ExceptionActionOutcome> => {
      const row = await lock(tx, found.id);
      if (!row || row.status !== "open")
        return { ok: false, error: "not_open" };
      if (sent) {
        await close(tx, row.id, "resolved", input.reason);
      } else {
        await recordAttempt(tx, row.id, `resend: ${result}`, {});
      }
      await audit(tx, input, "resend", result);
      return { ok: true, result, closed: sent };
    });
  }

  /** 标记已处理 / 忽略：写处理说明并关单，不动任何钱。 */
  async function resolve(
    input: ActionInput & { status: "resolved" | "ignored" },
  ): Promise<ExceptionActionOutcome> {
    return db().transaction(async (tx): Promise<ExceptionActionOutcome> => {
      const row = await lock(tx, input.exceptionId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.status !== "open") return { ok: false, error: "not_open" };
      await close(tx, row.id, input.status, input.reason);
      await audit(
        tx,
        input,
        input.status === "resolved" ? "resolve" : "ignore",
        input.status,
      );
      return { ok: true, result: input.status, closed: true };
    });
  }

  return { retryReclaim, recheck, resendNotification, resolve };
}

export type ExceptionService = ReturnType<typeof createExceptionService>;
