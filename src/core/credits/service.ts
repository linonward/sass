import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/core/db/client";
import {
  creditTransactions,
  userCredits,
  type CreditTransactionType,
} from "@/core/db/schema";

import {
  CreditsDisabledError,
  CreditTransactionNotFoundError,
  InsufficientCreditsError,
} from "./errors";

/** db 本身或其中的事务；传入事务时，积分操作作为它的一部分提交或回滚。 */
export type Executor =
  Parameters<Parameters<Database["transaction"]>[0]>[0] | Database;

export type WriteOptions = { tx?: Executor };

export type CreditTransaction = typeof creditTransactions.$inferSelect;

/**
 * 写操作的结果。`duplicate` 表示同一 (source, sourceId) 已经处理过：
 * 本次没有任何改动，返回的是已有的那条流水和当前余额。
 */
export type WriteResult = {
  status: "applied" | "duplicate";
  transaction: CreditTransaction;
  balance: number;
};

// 退款流水的来源固定为 refund，sourceId 是被退款的扣减流水 id，保证每笔扣减只能退一次。
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
  amount: z
    .number()
    .int()
    .min(-2_147_483_647)
    .max(2_147_483_647)
    .refine((n) => n !== 0, "must not be zero"),
});
const refundInput = z.object({
  userId: z.string().min(1),
  /** 被退款的那笔扣减的来源。 */
  source: z.string().min(1),
  sourceId: z.string().min(1),
  /** 默认全额退还；不能超过原扣减金额。 */
  amount: positiveInt.optional(),
  reason: z.string().optional(),
});

export type GrantInput = z.input<typeof grantInput>;
export type DeductInput = z.input<typeof deductInput>;
export type AdjustInput = z.input<typeof adjustInput>;
export type RefundInput = z.input<typeof refundInput>;

type Entry = {
  userId: string;
  type: CreditTransactionType;
  amount: number;
  source: string;
  sourceId: string;
  reason?: string;
};

/**
 * 创建积分服务。默认实例见 `./index.ts`；测试可以注入自己的数据库和开关。
 *
 * 写操作的顺序：先写流水（`(source, source_id)` 冲突则判定为重复，直接返回），再改余额。
 * 每个写操作都包在 `transaction()` 里：没传 tx 时开新事务，传了 tx 时是它的 savepoint，
 * 余额不足等错误只回滚这一步，不会在调用方的事务里留下半截流水。
 */
export function createCredits(options: {
  db: Database | (() => Database);
  enabled: boolean;
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

  /** 写入流水；来源重复时返回 undefined，并读出已有的那条。 */
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

  /** 增加余额（用户还没有余额记录时创建）。 */
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

  /** 原子扣减：余额不足时一行都不更新，抛出 InsufficientCreditsError。 */
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
    return (tx ?? getDb()).transaction(async (executor) => {
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
    });
  }

  return {
    /** 当前余额；从未发放过积分的用户为 0。 */
    async getBalance(userId: string, { tx }: WriteOptions = {}) {
      assertEnabled();
      return balanceOf(tx ?? getDb(), userId);
    },

    /** 发放积分（购买、订阅续费、赠送）。 */
    async grantCredits(input: GrantInput, { tx }: WriteOptions = {}) {
      const { amount, ...rest } = grantInput.parse(input);
      return write({ ...rest, type: "grant", amount }, tx, (executor) =>
        increase(executor, rest.userId, amount),
      );
    },

    /** 扣减积分。余额不足时抛出 InsufficientCreditsError，余额和流水都不变。 */
    async deductCredits(input: DeductInput, { tx }: WriteOptions = {}) {
      const { amount, ...rest } = deductInput.parse(input);
      return write(
        { ...rest, type: "deduct", amount: -amount },
        tx,
        (executor) => decrease(executor, rest.userId, amount),
      );
    },

    /**
     * 退还一笔扣减（比如 AI 调用失败）。按扣减时的 (source, sourceId) 定位原流水；
     * 每笔扣减只能退一次，重复调用返回 duplicate。
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

    /** 管理员手动调整，可正可负；负向调整不能让余额变成负数。 */
    async adjustCredits(input: AdjustInput, { tx }: WriteOptions = {}) {
      const { amount, ...rest } = adjustInput.parse(input);
      return write({ ...rest, type: "adjust", amount }, tx, (executor) =>
        amount > 0
          ? increase(executor, rest.userId, amount)
          : decrease(executor, rest.userId, -amount),
      );
    },

    /** 最近的流水，按时间倒序。 */
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
