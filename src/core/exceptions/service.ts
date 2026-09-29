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

/** The target_kind for billing exceptions in the audit table. */
export const EXCEPTION_TARGET = "billing_exception";

export type ExceptionActionName =
  "resend" | "retry_reclaim" | "recheck" | "resolve" | "ignore";

/**
 * The result of one handling action. `result` is the machine-readable result written to the audit
 * table (also shown in the handling history in the admin):
 * - retry reclaim: `reclaimed:<n>` (fully collected, closes the exception) / `partial:<n>/<owed>`
 *   (still short) / `uncollectible:<owed>` (balance is 0) / `nothing_owed` (the ledger no longer
 *   shows a debt, closes the exception) / `order_missing`;
 * - reconcile again: `recovered:<status>` (task still pending, advanced via the recovery path) /
 *   `provider:<status>` (task already finished, only records what the provider says now) /
 *   `provider_unavailable` / `provider_error`;
 * - resend email: `sent` (went out, closes the exception) / `retry` / `failed` (failed again, the
 *   exception stays open) / `skipped` (this email can no longer be resent, e.g. the verification
 *   code's plaintext has been purged);
 * - mark resolved / ignore: `resolved` / `ignored`.
 * `closed` means the exception is no longer open after this action.
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
  /**
   * Outbox for transactional emails: permanently failed emails are resent from here (see
   * @/core/email/outbox).
   */
  outbox: {
    resend: (id: string) => Promise<"sent" | "retry" | "failed" | "skipped">;
  };
};

type ActionInput = { actorId: string; exceptionId: string; reason: string };

/**
 * Handling actions for the exceptions page. Every action:
 * - only handles open exceptions (already handled ones return `not_open` and nothing is repeated);
 * - reuses the existing idempotent paths instead of writing new money logic (reclaim goes through
 *   `reclaimCredits`, AI tasks through the recovery sweep's settlement path);
 * - records one row in `admin_actions`: who, when, which exception, what was done, why, and the
 *   result.
 *
 * Permissions are not checked here — the caller (the Server Action) verifies admin identity first.
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

  /**
   * Lock the exception inside the transaction before checking its status: of two concurrent
   * actions, only one sees it open.
   */
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
   * Retry reclaim: lock the order row, recompute from the ledger how much this order owes **now**,
   * and deduct exactly that.
   *
   * Double deduction is prevented by "lock + recompute", not by a new idempotency key: of two
   * concurrent retries, the later one waits on the order row lock for the first to commit; when it
   * recomputes, the reclaimed credits already include what the first one deducted, so the amount
   * owed shrinks or reaches zero and nothing is over-deducted. The sourceId for the ledger entry
   * sits under the same order's `:refund:` prefix (`retryReclaimSourceId`), so it shares one
   * "already reclaimed" measure with the webhook reclaim; it includes the attempt number, so a
   * duplicate submit of the same attempt hits the unique key.
   *
   * Lock order matches the webhook reclaim: order first, then the exception — the two sides can't
   * deadlock each other.
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
        // The ledger no longer shows a debt (e.g. a later refund reclaim on the same order made it
        // up): close the exception with the admin's reason.
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
   * Reconcile an AI task again:
   * - task still pending: advance it through the same path as the recovery sweep (ask the
   *   provider first, save any result first); close the exception (with the admin's reason) if it
   *   reaches a terminal state, keep it open if it is still waiting;
   * - task already finished (refunded as "no result"): only ask the provider what it says now and
   *   record that on the exception, without touching money — if the provider later succeeded,
   *   whether to claw back or deliver is a human call, followed by "mark resolved".
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
        // When the reconcile got a provider status (lastError is null), this also clears the
        // previous error message.
        await recordAttempt(tx, row.id, lastError, detail);
      }
      await audit(tx, input, "recheck", result);
      return { ok: true, result, closed: settled };
    });
  }

  /**
   * Resend a permanently failed email: put its outbox row back in the queue and send it once right
   * away. If it goes out, close the exception; if it fails again, keep it open (the outbox keeps
   * retrying with backoff, and when retries run out again it updates this exception's attempts and
   * error). Note this is at-least-once: the dedupe slot was released when the email failed for
   * good, so if the same event triggered another email in the meantime, the resend adds an extra
   * one — which is why a human has to press the button and write a reason.
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

  /** Mark resolved / ignore: write the resolution note and close, without touching any money. */
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
