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
  console.warn(
    "Skipping credits tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

describe.skipIf(!url)("credits ledger", () => {
  let client: DbClient;
  let credits: Credits;

  beforeAll(async () => {
    // The test makes sure the schema is current itself instead of relying on db:migrate having run.
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

  /** Sum of amount over all of this user's transactions; must always equal the balance. */
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

  test("grant: creates the balance row if missing; balance equals the ledger sum", async () => {
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

  test("repeated grants with the same sourceId are credited once and return duplicate", async () => {
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

  test("concurrent repeated grants with the same sourceId are also credited once", async () => {
    const userId = await newUser();
    const input = { userId, amount: 10, source: "order", sourceId: source() };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => credits.grantCredits(input)),
    );

    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(10);
    expect(await transactionCount(userId)).toBe(1);
  });

  test("50 concurrent deductions: balance never goes negative; ledger sum equals balance", async () => {
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

  test("when the balance covers only some concurrent requests, the success count is exactly what the balance allows", async () => {
    const userId = await newUser();
    await credits.grantCredits({
      userId,
      amount: 70,
      source: "test",
      sourceId: source(),
    });

    // 3 per deduction; 70 covers only 23.
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
    // Failed deductions leave no transactions: 1 grant + 23 deductions.
    expect(await transactionCount(userId)).toBe(24);
  });

  test("insufficient balance throws InsufficientCreditsError; balance and ledger unchanged", async () => {
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

  test("a user who never had a balance also gets insufficient balance on deduction", async () => {
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

  test("repeated deductions with the same sourceId deduct once", async () => {
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

  describe("refund", () => {
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

    test("refunds the full original deduction by default", async () => {
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

    test("allows partial refunds", async () => {
      const { userId, call } = await userWithDeduction(8);
      const result = await credits.refundCredits({
        userId,
        ...call,
        amount: 3,
      });
      expect(result.balance).toBe(15);
    });

    test("repeated refunds have no effect", async () => {
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

    test("refund amount cannot exceed the original deduction", async () => {
      const { userId, call } = await userWithDeduction(8);
      await expect(
        credits.refundCredits({ userId, ...call, amount: 9 }),
      ).rejects.toThrow(RangeError);
      expect(await credits.getBalance(userId)).toBe(12);
    });

    test("throws when the original deduction is not found", async () => {
      const userId = await newUser();
      await expect(
        credits.refundCredits({ userId, source: "ai", sourceId: source() }),
      ).rejects.toBeInstanceOf(CreditTransactionNotFoundError);
    });

    test("cannot refund someone else's deduction", async () => {
      const { call } = await userWithDeduction(8);
      const other = await newUser();
      await expect(
        credits.refundCredits({ userId: other, ...call }),
      ).rejects.toBeInstanceOf(CreditTransactionNotFoundError);
    });
  });

  describe("adjust", () => {
    test("can be positive or negative; a negative adjustment cannot make the balance negative", async () => {
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

  describe("outer transaction", () => {
    test("when the outer transaction rolls back, credit changes roll back with it", async () => {
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

    test("a failed deduction inside an outer transaction rolls back only that step; the outer transaction can still commit", async () => {
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

  test("deleting the user cascades to the balance and the ledger", async () => {
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

  test("listTransactions returns newest first", async () => {
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

  test("database constraint as a backstop: writing a negative balance directly is rejected", async () => {
    const userId = await newUser();
    await expect(
      client.db.insert(userCredits).values({ userId, balance: -1 }),
    ).rejects.toThrow();
  });

  describe("reclaim (clamp)", () => {
    const reclaim = (userId: string, amount: number, sourceId = source()) =>
      credits.reclaimCredits({
        userId,
        amount,
        source: "billing-refund",
        sourceId,
      });

    test("deducts in full when the balance is enough; shortfall is 0", async () => {
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

    test("deducts down to 0 when the balance is short and returns the shortfall as is", async () => {
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

    test("with a balance of 0, writes no transaction and does not throw (amount has a non-zero constraint, nothing to record)", async () => {
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

    test("repeated reclaims with the same (source, sourceId) deduct once", async () => {
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
      // One grant + one reclaim.
      expect(await transactionCount(userId)).toBe(2);
    });

    test("concurrent reclaims: only one can deduct; balance and ledger sum stay consistent", async () => {
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

describe("input validation and the flag (no database needed)", () => {
  const unreachable = () => {
    throw new Error("database should not be touched");
  };

  test("with features.credits off, every API throws CreditsDisabledError without touching the database", async () => {
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
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["out of int range", 2 ** 31],
  ])("rejects amount when %s", async (_, amount) => {
    const credits = createCredits({ db: unreachable, enabled: true });
    await expect(
      credits.grantCredits({ userId: "u", amount, source: "s", sourceId: "1" }),
    ).rejects.toThrow();
  });

  test("source cannot use the reserved refund", async () => {
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
