import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/core/db/client";
import {
  creditTransactions,
  userCredits,
  type CreditTransactionType,
} from "@/core/db/schema";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";
import { withSpan } from "@/core/observability/trace";

import {
  CreditsDisabledError,
  CreditTransactionNotFoundError,
  InsufficientCreditsError,
} from "./errors";

/**
 * The db itself or a transaction on it; when a transaction is passed, the credits operation commits
 * or rolls back as part of it.
 */
export type Executor =
  Parameters<Parameters<Database["transaction"]>[0]>[0] | Database;

export type AfterCommitCallback = () => Promise<void> | void;

export type WriteOptions = {
  tx?: Executor;
  /**
   * Provided by the caller when passing an outer transaction: registers callbacks to run after the
   * caller's transaction commits (e.g. the low-balance reminder email). Without tx, the credits
   * service commits its own transaction and this is not needed. If tx is passed without
   * afterCommit, the low-balance reminder is skipped (there is no way to know when the transaction
   * commits).
   */
  afterCommit?: (fn: AfterCommitCallback) => void;
};

/**
 * onCross is called when a deduction takes the balance from >= threshold to < threshold. onCross
 * runs inside the deduction's transaction (it can use executor to write a dedupe record); side
 * effects such as sending email should be registered with schedule to run after the transaction
 * commits.
 */
export type LowBalanceHook = {
  threshold: number;
  onCross: (context: {
    executor: Executor;
    userId: string;
    balance: number;
    schedule: (fn: AfterCommitCallback) => void;
  }) => Promise<void>;
};

export type CreditTransaction = typeof creditTransactions.$inferSelect;

/**
 * The result of a write. `duplicate` means the same (source, sourceId) was already processed: nothing
 * changed this time, and the existing transaction and the current balance are returned.
 */
export type WriteResult = {
  status: "applied" | "duplicate";
  transaction: CreditTransaction;
  balance: number;
};

// Refund transactions always have source refund and sourceId set to the refunded deduction's id,
// which guarantees each deduction can be refunded only once.
const REFUND_SOURCE = "refund";

const positiveInt = z.number().int().positive().max(2_147_483_647);
const sourceFields = {
  userId: z.string().min(1),
  source: z
    .string()
    .min(1)
    .refine((s) => s !== REFUND_SOURCE, `"${REFUND_SOURCE}" is reserved`),
  sourceId: z.string().min(1),
  reason: z.string().optional(),
};

const grantInput = z.object({ ...sourceFields, amount: positiveInt });
const deductInput = grantInput;
const adjustInput = z.object({
  ...sourceFields,
  /** The actor (usually an admin), recorded in the transaction's actor_id. */
  actorId: z.string().min(1).optional(),
  amount: z
    .number()
    .int()
    .min(-2_147_483_647)
    .max(2_147_483_647)
    .refine((n) => n !== 0, "must not be zero"),
});
const refundInput = z.object({
  userId: z.string().min(1),
  /** The source of the deduction being refunded. */
  source: z.string().min(1),
  sourceId: z.string().min(1),
  /** Defaults to a full refund; cannot exceed the original deduction. */
  amount: positiveInt.optional(),
  reason: z.string().optional(),
});
const reclaimInput = z.object({ ...sourceFields, amount: positiveInt });

export type GrantInput = z.input<typeof grantInput>;
export type DeductInput = z.input<typeof deductInput>;
export type AdjustInput = z.input<typeof adjustInput>;
export type RefundInput = z.input<typeof refundInput>;
export type ReclaimInput = z.input<typeof reclaimInput>;

/**
 * The result of reclaiming credits.
 * - `applied`: after capping at the balance, `reclaimed` was actually deducted; the shortfall is in
 *   `shortfall` (balance was not enough).
 * - `duplicate`: the same (source, sourceId) was already deducted; nothing was done this time, and
 *   `reclaimed` is the amount deducted last time.
 * - `uncollectible`: the balance is 0 and nothing can be deducted; the credit transactions table's
 *   `amount <> 0` constraint means no transaction is written for this event.
 */
export type ReclaimResult = {
  status: "applied" | "duplicate" | "uncollectible";
  reclaimed: number;
  shortfall: number;
  balance: number;
  transaction?: CreditTransaction;
};

type Entry = {
  userId: string;
  type: CreditTransactionType;
  amount: number;
  source: string;
  sourceId: string;
  reason?: string;
  actorId?: string;
};

/**
 * Creates the credits service. The default instance is in `./index.ts`; tests can inject their own
 * database and flag.
 *
 * Write order: insert the transaction first (a `(source, source_id)` conflict means a duplicate,
 * returned right away), then update the balance. Every write is wrapped in `transaction()`: without
 * tx it opens a new transaction, with tx it is a savepoint of it, so errors such as insufficient
 * balance roll back only this step and never leave a half-written entry in the caller's
 * transaction.
 */
export function createCredits(options: {
  db: Database | (() => Database);
  enabled: boolean;
  lowBalance?: LowBalanceHook;
}) {
  const getDb = () =>
    typeof options.db === "function" ? options.db() : options.db;

  function assertEnabled() {
    if (!options.enabled) throw new CreditsDisabledError();
  }

  async function balanceOf(executor: Executor, userId: string) {
    const [row] = await executor
      .select({ balance: userCredits.balance })
      .from(userCredits)
      .where(eq(userCredits.userId, userId));
    return row?.balance ?? 0;
  }

  /**
   * Inserts the transaction; on a duplicate source, returns undefined for the insert and reads the
   * existing one.
   */
  async function insertEntry(executor: Executor, entry: Entry) {
    const [inserted] = await executor
      .insert(creditTransactions)
      .values(entry)
      .onConflictDoNothing({
        target: [creditTransactions.source, creditTransactions.sourceId],
      })
      .returning();
    if (inserted) return { inserted };
    const [existing] = await executor
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.source, entry.source),
          eq(creditTransactions.sourceId, entry.sourceId),
        ),
      );
    return { existing: existing! };
  }

  /** Increases the balance (creating the balance row if the user has none yet). */
  async function increase(executor: Executor, userId: string, amount: number) {
    const [row] = await executor
      .insert(userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({
        target: userCredits.userId,
        set: {
          balance: sql`${userCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        },
      })
      .returning({ balance: userCredits.balance });
    return row!.balance;
  }

  /**
   * Atomic deduction: if the balance is insufficient, no row is updated and InsufficientCreditsError
   * is thrown.
   */
  async function decrease(executor: Executor, userId: string, amount: number) {
    const [row] = await executor
      .update(userCredits)
      .set({
        balance: sql`${userCredits.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userCredits.userId, userId),
          sql`${userCredits.balance} >= ${amount}`,
        ),
      )
      .returning({ balance: userCredits.balance });
    if (!row) throw new InsufficientCreditsError(userId, amount);
    return row.balance;
  }

  async function write(
    entry: Entry,
    tx: Executor | undefined,
    apply: (executor: Executor) => Promise<number>,
  ): Promise<WriteResult> {
    assertEnabled();
    // Grants, deductions, refunds, and adjustments all pass through here: one span plus one log
    // line recording the amount, source, and result.
    const fields = {
      userId: entry.userId,
      type: entry.type,
      amount: entry.amount,
      source: entry.source,
      sourceId: entry.sourceId,
    };
    const attributes = {
      "credits.user_id": entry.userId,
      "credits.amount": entry.amount,
      "credits.source": entry.source,
      "credits.source_id": entry.sourceId,
    };
    return withSpan(`credits.${entry.type}`, attributes, async (span) => {
      const written: WriteResult = await (tx ?? getDb()).transaction(
        async (executor) => {
          const result = await insertEntry(executor, entry);
          if (result.existing) {
            return {
              status: "duplicate",
              transaction: result.existing,
              balance: await balanceOf(executor, result.existing.userId),
            };
          }
          const balance = await apply(executor);
          return { status: "applied", transaction: result.inserted, balance };
        },
      );
      span.setAttributes({
        "credits.status": written.status,
        "credits.balance": written.balance,
      });
      logger.info("credits.write", {
        ...fields,
        status: written.status,
        balance: written.balance,
      });
      return written;
    });
  }

  return {
    /** Current balance; 0 for a user who has never been granted credits. */
    async getBalance(userId: string, { tx }: WriteOptions = {}) {
      assertEnabled();
      return balanceOf(tx ?? getDb(), userId);
    },

    /** Grants credits (purchase, subscription renewal, gift). */
    async grantCredits(input: GrantInput, { tx }: WriteOptions = {}) {
      const { amount, ...rest } = grantInput.parse(input);
      return write({ ...rest, type: "grant", amount }, tx, (executor) =>
        increase(executor, rest.userId, amount),
      );
    },

    /**
     * Deducts credits. Throws InsufficientCreditsError when the balance is insufficient; neither the
     * balance nor the ledger changes.
     */
    async deductCredits(
      input: DeductInput,
      { tx, afterCommit }: WriteOptions = {},
    ) {
      const { amount, ...rest } = deductInput.parse(input);
      const hook = options.lowBalance;
      // When we commit our own transaction, callbacks are collected and run after commit; with the
      // caller's transaction they are handed to the caller's afterCommit.
      const pending: AfterCommitCallback[] = [];
      const schedule = tx
        ? afterCommit
        : (fn: AfterCommitCallback) => pending.push(fn);

      const result = await write(
        { ...rest, type: "deduct", amount: -amount },
        tx,
        async (executor) => {
          const balance = await decrease(executor, rest.userId, amount);
          const crossed =
            hook &&
            hook.threshold > 0 &&
            balance + amount >= hook.threshold &&
            balance < hook.threshold;
          if (crossed && schedule) {
            await hook.onCross({
              executor,
              userId: rest.userId,
              balance,
              schedule,
            });
          }
          return balance;
        },
      );
      // Callbacks such as the low-balance reminder run after the response so they don't slow down
      // the caller being charged.
      await runAfterResponse(async () => {
        for (const fn of pending) {
          try {
            await fn();
          } catch (error) {
            logger.error("credits.after_commit_failed", error);
          }
        }
      });
      return result;
    },

    /**
     * Reclaims credits (e.g. reclaim on refund): deducts down to a balance of 0 at most and returns
     * any shortfall as is instead of throwing InsufficientCreditsError — an automatic reclaim that
     * doesn't add up shouldn't fail the caller's whole transaction. When nothing can be deducted
     * (balance is 0), no transaction is written: the amount column has a non-zero constraint and
     * there is nothing to record, so the caller has to record the shortfall elsewhere (the refund
     * reclaim logs it on the server; see billing/reclaim-credits.ts).
     */
    async reclaimCredits(
      input: ReclaimInput,
      { tx }: WriteOptions = {},
    ): Promise<ReclaimResult> {
      assertEnabled();
      const { amount, ...rest } = reclaimInput.parse(input);
      return (tx ?? getDb()).transaction(async (executor) => {
        // Row lock: the amount below is capped at the balance we read, and only locking this row
        // guarantees the balance can't go negative after capping (concurrent deductions wait on
        // this lock and see the value after our deduction).
        const [row] = await executor
          .select({ balance: userCredits.balance })
          .from(userCredits)
          .where(eq(userCredits.userId, rest.userId))
          .for("update");
        const balance = row?.balance ?? 0;
        const reclaimed = Math.min(amount, balance);
        const shortfall = amount - reclaimed;
        if (reclaimed <= 0) {
          // Nothing to deduct has two possible causes: there really is no balance, or this one was
          // already deducted (a duplicate submit). The latter returns duplicate so the caller
          // doesn't treat it as an unpaid debt.
          const [existing] = await executor
            .select()
            .from(creditTransactions)
            .where(
              and(
                eq(creditTransactions.source, rest.source),
                eq(creditTransactions.sourceId, rest.sourceId),
              ),
            );
          if (existing) {
            return {
              status: "duplicate" as const,
              reclaimed: -existing.amount,
              shortfall: 0,
              balance,
              transaction: existing,
            };
          }
          logger.info("credits.reclaim_uncollectible", {
            userId: rest.userId,
            source: rest.source,
            sourceId: rest.sourceId,
            amount,
            balance,
          });
          return {
            status: "uncollectible" as const,
            reclaimed: 0,
            shortfall,
            balance,
          };
        }
        const written = await write(
          { ...rest, type: "deduct", amount: -reclaimed },
          executor,
          (inner) => decrease(inner, rest.userId, reclaimed),
        );
        const duplicate = written.status === "duplicate";
        return {
          status: written.status,
          // On a duplicate submit, don't report the amount again: use what was actually deducted
          // last time, and the shortfall is zero.
          reclaimed: duplicate ? -written.transaction.amount : reclaimed,
          shortfall: duplicate ? 0 : shortfall,
          balance: written.balance,
          transaction: written.transaction,
        };
      });
    },

    /**
     * Refunds a deduction (e.g. a failed AI call). Finds the original transaction by the
     * deduction's (source, sourceId); each deduction can be refunded only once, and repeated calls
     * return duplicate.
     */
    async refundCredits(input: RefundInput, { tx }: WriteOptions = {}) {
      assertEnabled();
      const parsed = refundInput.parse(input);
      return (tx ?? getDb()).transaction(async (executor) => {
        const [original] = await executor
          .select()
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.source, parsed.source),
              eq(creditTransactions.sourceId, parsed.sourceId),
              eq(creditTransactions.userId, parsed.userId),
              eq(creditTransactions.type, "deduct"),
            ),
          );
        if (!original) {
          throw new CreditTransactionNotFoundError(
            parsed.source,
            parsed.sourceId,
          );
        }
        const deducted = -original.amount;
        const amount = parsed.amount ?? deducted;
        if (amount > deducted) {
          throw new RangeError(
            `Refund ${amount} exceeds the deducted amount ${deducted}`,
          );
        }
        return write(
          {
            userId: parsed.userId,
            type: "refund",
            amount,
            source: REFUND_SOURCE,
            sourceId: original.id,
            reason: parsed.reason,
          },
          executor,
          (inner) => increase(inner, parsed.userId, amount),
        );
      });
    },

    /**
     * Manual adjustment by an admin, positive or negative; a negative adjustment can't take the
     * balance below zero.
     */
    async adjustCredits(input: AdjustInput, { tx }: WriteOptions = {}) {
      const { amount, ...rest } = adjustInput.parse(input);
      return write({ ...rest, type: "adjust", amount }, tx, (executor) =>
        amount > 0
          ? increase(executor, rest.userId, amount)
          : decrease(executor, rest.userId, -amount),
      );
    },

    /** Recent transactions, newest first. */
    async listTransactions(
      userId: string,
      {
        limit = 50,
        offset = 0,
        tx,
      }: { limit?: number; offset?: number } & WriteOptions = {},
    ) {
      assertEnabled();
      return (tx ?? getDb())
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, userId))
        .orderBy(
          desc(creditTransactions.createdAt),
          desc(creditTransactions.id),
        )
        .limit(Math.min(Math.max(limit, 1), 200))
        .offset(Math.max(offset, 0));
    },
  };
}

export type Credits = ReturnType<typeof createCredits>;
