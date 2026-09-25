// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { InsufficientCreditsError } from "@/core/credits/errors";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import { creditTransactions, user } from "@/core/db/schema";

import { ADMIN_ADJUST_SOURCE, adjustUserCredits } from "./credits";
import { getUserDetail, listUsers } from "./queries";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

describe.skipIf(!url)("后台：积分调整和查询", () => {
  let client: DbClient;
  let credits: Credits;

  beforeAll(async () => {
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

  async function newUser(tag = "user") {
    const id = `admin-test-${randomUUID()}`;
    const email = `${tag}-${id}@example.com`;
    await client.db.insert(user).values({ id, name: tag, email });
    return { id, email };
  }

  test("调整后余额正确，流水是 adjust 并记录原因和操作的管理员", async () => {
    const admin = await newUser("admin");
    const target = await newUser();

    const added = await adjustUserCredits(credits, admin.id, {
      userId: target.id,
      amount: "50",
      reason: "  Goodwill credit  ",
      requestId: randomUUID(),
    });
    expect(added.status).toBe("applied");
    expect(added.balance).toBe(50);

    const removed = await adjustUserCredits(credits, admin.id, {
      userId: target.id,
      amount: -20,
      reason: "Correction",
      requestId: randomUUID(),
    });
    expect(removed.balance).toBe(30);

    const rows = await client.db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, target.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: "adjust",
        source: ADMIN_ADJUST_SOURCE,
        actorId: admin.id,
      });
    }
    expect(rows.map((r) => r.reason).sort()).toEqual([
      "Correction",
      "Goodwill credit",
    ]);

    // 详情页能看到是谁操作的。
    const detail = await getUserDetail(client.db, target.id);
    expect(detail!.balance).toBe(30);
    expect(detail!.transactions.map((tx) => tx.actorEmail)).toEqual([
      admin.email,
      admin.email,
    ]);
  });

  test("必须填写原因，金额必须是非零整数", async () => {
    const admin = await newUser("admin");
    const target = await newUser();
    const base = { userId: target.id, requestId: randomUUID() };

    for (const input of [
      { ...base, amount: 10, reason: "   " },
      { ...base, amount: 0, reason: "x" },
      { ...base, amount: 1.5, reason: "x" },
      { ...base, amount: "abc", reason: "x" },
    ]) {
      await expect(
        adjustUserCredits(credits, admin.id, input),
      ).rejects.toThrow();
    }
    expect(await credits.getBalance(target.id)).toBe(0);
  });

  test("同一 requestId 重复提交只生效一次", async () => {
    const admin = await newUser("admin");
    const target = await newUser();
    const input = {
      userId: target.id,
      amount: 5,
      reason: "Double click",
      requestId: randomUUID(),
    };

    const [first, second] = [
      await adjustUserCredits(credits, admin.id, input),
      await adjustUserCredits(credits, admin.id, input),
    ];
    expect(first.status).toBe("applied");
    expect(second.status).toBe("duplicate");
    expect(await credits.getBalance(target.id)).toBe(5);
  });

  test("负数调整不能让余额低于 0", async () => {
    const admin = await newUser("admin");
    const target = await newUser();
    await expect(
      adjustUserCredits(credits, admin.id, {
        userId: target.id,
        amount: -1,
        reason: "Too much",
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await credits.getBalance(target.id)).toBe(0);
  });

  test("管理员账户删除后，流水保留，操作者置空", async () => {
    const admin = await newUser("admin");
    const target = await newUser();
    await adjustUserCredits(credits, admin.id, {
      userId: target.id,
      amount: 1,
      reason: "Before leaving",
      requestId: randomUUID(),
    });
    await client.db.delete(user).where(eq(user.id, admin.id));

    const detail = await getUserDetail(client.db, target.id);
    expect(detail!.transactions).toHaveLength(1);
    expect(detail!.transactions[0]).toMatchObject({
      actorId: null,
      actorEmail: null,
    });
  });

  test("用户搜索按邮箱或名称匹配，通配符按字面处理", async () => {
    const tag = `find${randomUUID().slice(0, 8)}`;
    const a = await newUser(tag);
    await newUser(`${tag}_x`);

    const byEmail = await listUsers(client.db, {
      query: a.email.toUpperCase(),
    });
    expect(byEmail.rows.map((r) => r.id)).toEqual([a.id]);

    const byName = await listUsers(client.db, { query: tag });
    expect(byName.total).toBe(2);

    // "_" 不能当成单字符通配符。
    const literal = await listUsers(client.db, { query: `${tag}_` });
    expect(literal.total).toBe(1);

    expect(await listUsers(client.db, { query: "%" })).toMatchObject({
      total: 0,
    });
  });
});
