import { and, eq, lte } from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import { notificationLog } from "@/core/db/schema";

type Executor = Database | DbTransaction;

/**
 * Claims the send slot for a notification: true means send it this time, false means it was
 * already sent within the window.
 * - windowMs is null: each (kind, key) is sent only once;
 * - otherwise it returns true again only once more than windowMs has passed since the last send.
 * A single upsert decides, so only one of several concurrent callers gets the slot. Run it in the
 * same transaction as the business write so the claim rolls back with it; send the email after the
 * transaction commits.
 *
 * A claim only means "I'm the one sending this time". When sending fails, return the slot with
 * releaseNotificationClaim (see `./delivery.ts`): otherwise one failed send would hold
 * (kind, key) forever and the email could never go out.
 */
export async function claimNotification(
  executor: Executor,
  {
    kind,
    key,
    userId,
    windowMs,
    now = new Date(),
  }: {
    kind: string;
    key: string;
    userId: string;
    windowMs: number | null;
    now?: Date;
  },
): Promise<boolean> {
  const insert = executor
    .insert(notificationLog)
    .values({ kind, key, userId, lastSentAt: now });
  const rows =
    windowMs === null
      ? await insert
          .onConflictDoNothing({
            target: [notificationLog.kind, notificationLog.key],
          })
          .returning({ kind: notificationLog.kind })
      : await insert
          .onConflictDoUpdate({
            target: [notificationLog.kind, notificationLog.key],
            set: { lastSentAt: now, userId },
            // lte encodes the parameter with the column's own encoding (same as on write), so a
            // Date serialized in the machine's time zone doesn't skew the comparison.
            setWhere: lte(
              notificationLog.lastSentAt,
              new Date(now.getTime() - windowMs),
            ),
          })
          .returning({ kind: notificationLog.kind });
  return rows.length > 0;
}

/**
 * Releases a notification's send slot: call it when the email ultimately fails to send, so later
 * attempts with the same key (provider replays, manual resends, the next window) can claim the
 * slot again and actually get the email out.
 *
 * `now` must be the same time that was passed to claimNotification when claiming: only a row that
 * **still belongs to this attempt** is deleted. If another path re-claimed the slot while sending
 * (the window expired and that send succeeded), the row's last_sent_at is a newer time, so it
 * doesn't match and isn't deleted — otherwise we'd wrongly delete someone else's claim and end up
 * sending duplicates. Returns whether the slot was actually released (false means a newer send
 * took over the row, or it was already gone).
 *
 * The semantic tradeoff: a failed attempt doesn't count as "sent", so the window (windowMs)
 * restarts from the next successful send. Delivered emails are still bound by the window (no
 * repeats within one window), while failed ones can be retried.
 */
export async function releaseNotificationClaim(
  executor: Executor,
  { kind, key, now }: { kind: string; key: string; now: Date },
): Promise<boolean> {
  const rows = await executor
    .delete(notificationLog)
    .where(
      and(
        eq(notificationLog.kind, kind),
        eq(notificationLog.key, key),
        // Use the column's own encoding (same as on write), so a Date serialized in the
        // machine's time zone doesn't skew the comparison.
        eq(notificationLog.lastSentAt, now),
      ),
    )
    .returning({ kind: notificationLog.kind });
  return rows.length > 0;
}
