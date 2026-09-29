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

/**
 * Maximum send attempts per row (including the immediate attempts right after commit). Once used
 * up, the row ends as failed.
 */
export const OUTBOX_MAX_ATTEMPTS = 8;

/**
 * After the immediate send fails, how long to wait before the nth retry. How often the sweep runs
 * is up to the deployment (see the recovery sweep section in the README); this is only "the
 * earliest it may be retried". About 7 hours in total: long enough to ride out a real provider
 * outage, short enough that a payment confirmation doesn't arrive the next day.
 */
const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
];

/**
 * A row stuck in `sending` for this long most likely means the sending process died; put it back
 * to pending so the sweep takes over.
 */
export const OUTBOX_SENDING_STALE_MS = 10 * 60 * 1000;

/**
 * Quick retries for the immediate send after commit (covers transient provider failures); same
 * parameters as the former in-process retry.
 */
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
  /**
   * Sensitive props (verification codes): stored encrypted, cleared once sent or discarded.
   * Requires the outbox to have a `secret`.
   */
  sensitive?: boolean;
  /** Don't send after this time. */
  expiresAt?: Date;
  /**
   * When the notification_log slot was claimed; used to release the slot on final failure. Omit
   * when there is no claim.
   */
  claimedAt?: Date;
  /** Discard older unsent rows with the same (kind, key) (a new code replaces the old one). */
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
 * Outbox for transactional emails.
 *
 * Flow: `enqueue` inside the business transaction (commits or rolls back together with the dedupe
 * claim and the business write) → after commit, `deliver` sends once right away (with a few quick
 * retries) → anything not yet sent stays in the database and `scan` retries it with backoff → once
 * retries run out, the row ends as `failed` and is kept, the dedupe claim is released, and a
 * `notification_failed` exception is opened so an admin can resend it manually.
 *
 * Each row is sent only once thanks to two layers:
 * 1. Before sending, claim the row with a state transition (a conditional pending → sending
 *    update), so only one of any concurrent sweeps / immediate sends wins;
 * 2. Sending carries the idempotency key `notification/<row id>` (Resend's Idempotency-Key, kept
 *    for 24 hours): if the process dies between "the provider accepted it" and "we recorded it as
 *    sent", the sweep moves the row from sending back to pending and sends again, and the provider
 *    recognizes it as the same email and doesn't deliver it twice.
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
  /** Key for encrypting sensitive props (BETTER_AUTH_SECRET). */
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

  /**
   * Final failure: keep the row (with sensitive props cleared), release the dedupe claim, and for
   * non-sensitive rows open an exception that can be resent.
   */
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
    // Resending an expired or superseded verification code is pointless, so no exception; other
    // critical emails get one and wait for a manual resend.
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
   * Delivers one row: if the claim succeeds, send it (with quick retries), then record it as sent,
   * schedule the next retry, or record a final failure. If the claim fails (someone else is
   * sending, not yet due, expired, already sent), returns `skipped`. Never throws.
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
            // Once a verification code is sent there's no reason to keep the original.
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
   * Retry sweep (called from the recovery entry point):
   * 1. Rows stuck in sending too long go back to pending (the sending process died);
   * 2. Expired rows that were never sent end as failed (a code past its validity is useless);
   * 3. Due rows are sent in order, up to `limit` rows.
   * Repeated sweeps are safe: every row has to be claimed before it's sent.
   */
  async function scan({
    limit = 20,
    userIds,
  }: {
    limit?: number;
    /** Only sweep these users' rows (for test isolation); omit to sweep everything. */
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
   * Manually resends an email that ended as failed (called from the admin exceptions page): puts
   * it back in the queue, resets the attempt count, and sends once right away. Rows whose sensitive
   * props were already cleared (verification codes) can't be resent and return `skipped`.
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
