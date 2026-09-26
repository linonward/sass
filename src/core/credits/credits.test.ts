// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { creditTransactions, user, userCredits } from "@/core/db/schema";

import {
  CreditsDisabledError,
  CreditTransactionNotFoundError,
  InsufficientCreditsError,
} from "./errors";
import { createCredits, type Credits } from "./service";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过积分测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

describe.skipIf(!url)("积分账本", () => {
  let client: DbClient;
  let credits: Credits;

  beforeAll(async () => {
    // 测试自己保证表结构是最新的，不依赖外部先执行 db:migrate。
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();

    client = createDbClient(url!);
    credits = createCredits({ db: client.db, enabled: true });
  });

  afterAll(async () => {
    await client?.close();
  });

  async function newUser() {
    const id = `credits-test-${randomUUID()}`;
    await client.db
      .insert(user)
      .values({ id, name: "Test", email: `${id}@example.com` });
    return id;
  }

  /** 该用户所有流水 amount 之和，应始终等于余额。 */
  async function ledgerSum(userId: string) {
    const [row] = await client.db
      .select({
        sum: sql<number>`coalesce(sum(${creditTransactions.amount}), 0)::int`,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    return row!.sum;
  }

  async function transactionCount(userId: string) {
    const [row] = await client.db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    return row!.count;
  }

  const source = () => `test-${randomUUID()}`;

  test("发放积分：没有余额记录时创建，余额等于流水之和", async () => {
    const userId = await newUser();
    expect(await credits.getBalance(userId)).toBe(0);

    const result = await credits.grantCredits({
      userId,
      amount: 100,
      source: "test",
      sourceId: source(),
      reason: "welcome bonus",
    });

    expect(result.status).toBe("applied");
    expect(result.balance).toBe(100);
    expect(result.transaction).toMatchObject({
      type: "grant",
      amount: 100,
      reason: "welcome bonus",
    });
    expect(await credits.getBalance(userId)).toBe(100);
    expect(await ledgerSum(userId)).toBe(100);
  });

  test("同一 sourceId 重复发放只到账一次，并返回 duplicate", async () => {
    const userId = await newUser();
    const input = { userId, amount: 30, source: "order", sourceId: source() };

    const first = await credits.grantCredits(input);
    const second = await credits.grantCredits(input);

    expect(first.status).toBe("applied");
    expect(second.status).toBe("duplicate");
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.balance).toBe(30);
    expect(await credits.getBalance(userId)).toBe(30);
    expect(await transactionCount(userId)).toBe(1);
  });

  test("并发重复发放同一 sourceId 也只到账一次", async () => {
    const userId = await newUser();
    const input = { userId, amount: 10, source: "order", sourceId: source() };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => credits.grantCredits(input)),
    );

    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(10);
    expect(await transactionCount(userId)).toBe(1);
  });

  test("50 个并发扣减：余额不会为负，流水总和等于余额", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 50,
      source: "test",
      sourceId: source(),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        credits.deductCredits({
          userId,
          amount: 1,
          source: "ai",
          sourceId: `${userId}-call-${i}`,
        }),
      ),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await credits.getBalance(userId)).toBe(0);
    expect(await ledgerSum(userId)).toBe(0);
  });

  test("余额只够一部分并发请求时，成功次数正好等于余额能支持的次数", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 70,
      source: "test",
      sourceId: source(),
    });

    // 每次扣 3，70 只够 23 次。
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        credits.deductCredits({
          userId,
          amount: 3,
          source: "ai",
          sourceId: `${userId}-call-${i}`,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(23);
    expect(rejected).toHaveLength(27);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        InsufficientCreditsError,
      );
    }
    expect(await credits.getBalance(userId)).toBe(1);
    expect(await ledgerSum(userId)).toBe(1);
    // 失败的扣减不留流水：1 条发放 + 23 条扣减。
    expect(await transactionCount(userId)).toBe(24);
  });

  test("余额不足时抛出 InsufficientCreditsError，余额和流水都不变", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 5,
      source: "test",
      sourceId: source(),
    });

    await expect(
      credits.deductCredits({
        userId,
        amount: 6,
        source: "ai",
        sourceId: source(),
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(await credits.getBalance(userId)).toBe(5);
    expect(await transactionCount(userId)).toBe(1);
  });

  test("从未有过余额的用户扣减时同样报余额不足", async () => {
    const userId = await newUser();
    await expect(
      credits.deductCredits({
        userId,
        amount: 1,
        source: "ai",
        sourceId: source(),
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await transactionCount(userId)).toBe(0);
  });

  test("同一 sourceId 重复扣减只扣一次", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 10,
      source: "test",
      sourceId: source(),
    });
    const input = { userId, amount: 4, source: "ai", sourceId: source() };

    expect((await credits.deductCredits(input)).status).toBe("applied");
    const again = await credits.deductCredits(input);

    expect(again.status).toBe("duplicate");
    expect(again.balance).toBe(6);
    expect(await credits.getBalance(userId)).toBe(6);
  });

  describe("退款", () => {
    async function userWithDeduction(deduct: number) {
      const userId = await newUser();
      await credits.grantCredits({
        userId,
        amount: 20,
        source: "test",
        sourceId: source(),
      });
      const call = { source: "ai", sourceId: source() };
      await credits.deductCredits({ userId, amount: deduct, ...call });
      return { userId, call };
    }

    test("默认全额退还原扣减", async () => {
      const { userId, call } = await userWithDeduction(8);

      const result = await credits.refundCredits({
        userId,
        ...call,
        reason: "model error",
      });

      expect(result.status).toBe("applied");
      expect(result.transaction).toMatchObject({
        type: "refund",
        amount: 8,
        reason: "model error",
      });
      expect(await credits.getBalance(userId)).toBe(20);
      expect(await ledgerSum(userId)).toBe(20);
    });

    test("可以部分退款", async () => {
      const { userId, call } = await userWithDeduction(8);
      const result = await credits.refundCredits({
        userId,
        ...call,
        amount: 3,
      });
      expect(result.balance).toBe(15);
    });

    test("重复退款不生效", async () => {
      const { userId, call } = await userWithDeduction(8);

      await credits.refundCredits({ userId, ...call });
      const again = await credits.refundCredits({ userId, ...call });
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () =>
          credits.refundCredits({ userId, ...call }),
        ),
      );

      expect(again.status).toBe("duplicate");
      expect(concurrent.every((r) => r.status === "duplicate")).toBe(true);
      expect(await credits.getBalance(userId)).toBe(20);
    });

    test("退款金额不能超过原扣减金额", async () => {
      const { userId, call } = await userWithDeduction(8);
      await expect(
        credits.refundCredits({ userId, ...call, amount: 9 }),
      ).rejects.toThrow(RangeError);
      expect(await credits.getBalance(userId)).toBe(12);
    });

    test("找不到原扣减时报错", async () => {
      const userId = await newUser();
      await expect(
        credits.refundCredits({ userId, source: "ai", sourceId: source() }),
      ).rejects.toBeInstanceOf(CreditTransactionNotFoundError);
    });

    test("不能退别人的扣减", async () => {
      const { call } = await userWithDeduction(8);
      const other = await newUser();
      await expect(
        credits.refundCredits({ userId: other, ...call }),
      ).rejects.toBeInstanceOf(CreditTransactionNotFoundError);
    });
  });

  describe("调整", () => {
    test("可正可负，负向调整不能让余额变成负数", async () => {
      const userId = await newUser();

      await credits.adjustCredits({
        userId,
        amount: 10,
        source: "admin",
        sourceId: source(),
        reason: "support",
      });
      const down = await credits.adjustCredits({
        userId,
        amount: -4,
        source: "admin",
        sourceId: source(),
      });
      expect(down.balance).toBe(6);

      await expect(
        credits.adjustCredits({
          userId,
          amount: -7,
          source: "admin",
          sourceId: source(),
        }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(await credits.getBalance(userId)).toBe(6);
      expect(await ledgerSum(userId)).toBe(6);
    });
  });

  describe("外部事务", () => {
    test("外部事务回滚时，积分变动一起回滚", async () => {
      const userId = await newUser();

      await expect(
        client.db.transaction(async (tx) => {
          await credits.grantCredits(
            { userId, amount: 40, source: "order", sourceId: source() },
            { tx },
          );
          expect(await credits.getBalance(userId, { tx })).toBe(40);
          throw new Error("webhook handler failed");
        }),
      ).rejects.toThrow("webhook handler failed");

      expect(await credits.getBalance(userId)).toBe(0);
      expect(await transactionCount(userId)).toBe(0);
    });

    test("在外部事务里扣减失败，只回滚这一步，外部事务可以继续提交", async () => {
      const userId = await newUser();

      await client.db.transaction(async (tx) => {
        await credits.grantCredits(
          { userId, amount: 5, source: "order", sourceId: source() },
          { tx },
        );
        await expect(
          credits.deductCredits(
            { userId, amount: 6, source: "ai", sourceId: source() },
            { tx },
          ),
        ).rejects.toBeInstanceOf(InsufficientCreditsError);
      });

      expect(await credits.getBalance(userId)).toBe(5);
      expect(await transactionCount(userId)).toBe(1);
    });
  });

  test("删除用户后，余额和流水被级联删除", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 9,
      source: "test",
      sourceId: source(),
    });

    await client.db.delete(user).where(eq(user.id, userId));

    const balances = await client.db
      .select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId));
    expect(balances).toEqual([]);
    expect(await transactionCount(userId)).toBe(0);
  });

  test("listTransactions 按时间倒序返回", async () => {
    const userId = await newUser();
    const ids = [source(), source(), source()];
    for (const sourceId of ids) {
      await credits.grantCredits({
        userId,
        amount: 1,
        source: "test",
        sourceId,
      });
    }

    const list = await credits.listTransactions(userId, { limit: 2 });

    expect(list).toHaveLength(2);
    expect(list[0]!.sourceId).toBe(ids[2]);
    expect(list[1]!.sourceId).toBe(ids[1]);
  });

  test("数据库约束兜底：直接写入负余额会被拒绝", async () => {
    const userId = await newUser();
    await expect(
      client.db.insert(userCredits).values({ userId, balance: -1 }),
    ).rejects.toThrow();
  });

  describe("回收（clamp）", () => {
    const reclaim = (userId: string, amount: number, sourceId = source()) =>
      credits.reclaimCredits({
        userId,
        amount,
        source: "billing-refund",
        sourceId,
      });

    test("余额够时足额扣减，差额为 0", async () => {
      const userId = await newUser();
      await credits.grantCredits({
        userId,
        amount: 100,
        source: "test",
        sourceId: source(),
      });

      const result = await reclaim(userId, 100);

      expect(result).toMatchObject({
        status: "applied",
        reclaimed: 100,
        shortfall: 0,
        balance: 0,
      });
      expect(result.transaction).toMatchObject({
        type: "deduct",
        amount: -100,
      });
      expect(await ledgerSum(userId)).toBe(0);
    });

    test("余额不够时扣到 0，差额原样返回", async () => {
      const userId = await newUser();
      await credits.grantCredits({
        userId,
        amount: 40,
        source: "test",
        sourceId: source(),
      });

      const result = await reclaim(userId, 100);

      expect(result).toMatchObject({
        status: "applied",
        reclaimed: 40,
        shortfall: 60,
        balance: 0,
      });
      expect(result.transaction).toMatchObject({ amount: -40 });
      expect(await credits.getBalance(userId)).toBe(0);
      expect(await ledgerSum(userId)).toBe(0);
    });

    test("余额为 0 时不写流水也不报错（amount 有非零约束，没有额度可记）", async () => {
      const userId = await newUser();

      const result = await reclaim(userId, 100);

      expect(result).toMatchObject({
        status: "uncollectible",
        reclaimed: 0,
        shortfall: 100,
        balance: 0,
      });
      expect(await transactionCount(userId)).toBe(0);
    });

    test("同一 (source, sourceId) 重复回收只扣一次", async () => {
      const userId = await newUser();
      await credits.grantCredits({
        userId,
        amount: 100,
        source: "test",
        sourceId: source(),
      });
      const sourceId = source();

      const first = await reclaim(userId, 100, sourceId);
      const second = await reclaim(userId, 100, sourceId);

      expect(first.status).toBe("applied");
      expect(second).toMatchObject({
        status: "duplicate",
        reclaimed: 100,
        shortfall: 0,
        balance: 0,
      });
      expect(await credits.getBalance(userId)).toBe(0);
      // 一条发放 + 一条回收。
      expect(await transactionCount(userId)).toBe(2);
    });

    test("并发回收：只有一笔扣得动，余额与流水之和保持一致", async () => {
      const userId = await newUser();
      await credits.grantCredits({
        userId,
        amount: 100,
        source: "test",
        sourceId: source(),
      });

      const results = await Promise.all([
        reclaim(userId, 100, source()),
        reclaim(userId, 100, source()),
      ]);

      expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
      expect(results.filter((r) => r.status === "uncollectible")).toHaveLength(
        1,
      );
      expect(results.reduce((sum, r) => sum + r.reclaimed, 0)).toBe(100);
      expect(await credits.getBalance(userId)).toBe(0);
      expect(await ledgerSum(userId)).toBe(0);
    });
  });
});

describe("参数校验与开关（不需要数据库）", () => {
  const unreachable = () => {
    throw new Error("database should not be touched");
  };

  test("features.credits 关闭时所有 API 抛出 CreditsDisabledError，且不访问数据库", async () => {
    const disabled = createCredits({ db: unreachable, enabled: false });
    const input = { userId: "u", amount: 1, source: "s", sourceId: "1" };

    await expect(disabled.getBalance("u")).rejects.toBeInstanceOf(
      CreditsDisabledError,
    );
    await expect(disabled.grantCredits(input)).rejects.toBeInstanceOf(
      CreditsDisabledError,
    );
    await expect(disabled.deductCredits(input)).rejects.toBeInstanceOf(
      CreditsDisabledError,
    );
    await expect(
      disabled.refundCredits({ userId: "u", source: "s", sourceId: "1" }),
    ).rejects.toBeInstanceOf(CreditsDisabledError);
    await expect(
      disabled.reclaimCredits({
        userId: "u",
        amount: 1,
        source: "s",
        sourceId: "1",
      }),
    ).rejects.toBeInstanceOf(CreditsDisabledError);
    await expect(disabled.adjustCredits(input)).rejects.toBeInstanceOf(
      CreditsDisabledError,
    );
    await expect(disabled.listTransactions("u")).rejects.toBeInstanceOf(
      CreditsDisabledError,
    );
  });

  test.each([
    ["零", 0],
    ["负数", -1],
    ["小数", 1.5],
    ["超出 int 范围", 2 ** 31],
  ])("amount 为%s时拒绝", async (_, amount) => {
    const credits = createCredits({ db: unreachable, enabled: true });
    await expect(
      credits.grantCredits({ userId: "u", amount, source: "s", sourceId: "1" }),
    ).rejects.toThrow();
  });

  test("source 不能使用保留的 refund", async () => {
    const credits = createCredits({ db: unreachable, enabled: true });
    await expect(
      credits.grantCredits({
        userId: "u",
        amount: 1,
        source: "refund",
        sourceId: "1",
      }),
    ).rejects.toThrow(/reserved/);
  });
});
