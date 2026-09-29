import { eq } from "drizzle-orm";

import { preferredLocale } from "@/core/account/locale";
import { db as defaultDb } from "@/core/db";
import { user } from "@/core/db/schema";
import {
  createOutbox,
  type DatabaseSource,
  type DeliveryRetry,
} from "@/core/email/outbox";
import { siteLink } from "@/core/email/links";
import { claimNotification } from "@/core/email/notification-log";
import type { SendEmailOptions } from "@/core/email/send";
import type { SendOptions } from "@/core/email/transports";

import type { LowBalanceHook } from "./service";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Sends the credits-low email when the balance drops below the threshold, at most one per user per
 * 24 hours. The dedupe slot is claimed inside the deduction's transaction (only one of several
 * concurrent deductions can get it), and the email is sent after the transaction commits. The email
 * and the slot are written to the outbox together and sent once right after commit; if that send
 * fails, the recovery sweep resends it, and the deduction succeeds either way.
 *
 * "At most one per 24 hours" counts the send that **succeeded**: an attempt that still fails after
 * all retries releases its slot, so the next time the balance crosses the threshold the user is
 * reminded again — one delivery failure does not cost the user their reminder.
 * `db` is used for the post-commit send and bookkeeping (by then the deduction's transaction has
 * committed, and the executor the hook receives may be the caller's tx).
 */
export function createLowBalanceHook({
  threshold,
  send,
  db = defaultDb,
  retry,
  now = () => new Date(),
}: {
  threshold: number;
  send: (
    options: SendEmailOptions<"credits-low">,
    sendOptions?: SendOptions,
  ) => Promise<unknown>;
  /** Database for the post-commit send and bookkeeping; defaults to the global connection. */
  db?: DatabaseSource;
  /**
   * Quick retries for the immediate post-commit send; defaults to 3 attempts with exponential
   * backoff starting at 500ms.
   */
  retry?: DeliveryRetry;
  now?: () => Date;
}): LowBalanceHook {
  const outbox = createOutbox({
    db,
    // The outbox stores and loads by template name; this hook only ever writes credits-low.
    send: (options, sendOptions) =>
      send(options as SendEmailOptions<"credits-low">, sendOptions),
    retry,
    now,
  });
  return {
    threshold,
    async onCross({ executor, userId, balance, schedule }) {
      const [recipient] = await executor
        .select({ email: user.email, locale: user.locale })
        .from(user)
        .where(eq(user.id, userId));
      if (!recipient) return;

      const locale = preferredLocale(recipient);
      const claimedAt = now();
      const claimed = await claimNotification(executor, {
        kind: "credits-low",
        key: userId,
        userId,
        windowMs: DAY,
        now: claimedAt,
      });
      if (!claimed) return;

      const id = await outbox.enqueue(executor, {
        kind: "credits-low",
        key: userId,
        userId,
        to: recipient.email,
        template: "credits-low",
        props: { balance, threshold, topUpUrl: siteLink(locale, "/pricing") },
        locale,
        claimedAt,
      });
      schedule(async () => {
        await outbox.deliver(id);
      });
    },
  };
}
