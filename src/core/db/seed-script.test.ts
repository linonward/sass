// @vitest-environment node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { listUsers } from "@/core/admin/queries";
import { getBillingOverview } from "@/core/billing/overview";
import { listTransactions } from "@/core/credits";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  creditTransactions,
  orders,
  subscriptions,
  user,
  userCredits,
} from "@/core/db/schema";

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL_TEST;

// CI 必须提供测试库，不允许静默跳过。
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过演示数据测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

const DEMO_EMAILS = ["demo@example.com", "demo-churn@example.com"];

describe.skipIf(!url)("scripts/db-seed.mjs", () => {
  let client: DbClient;
  let db: DbClient["db"];

  const script = path.resolve(__dirname, "../../../scripts/db-seed.mjs");

  /** 跑脚本；非零退出时把 stderr 一起返回（测试自己断言）。 */
  async function seed() {
    try {
      const { stdout } = await execFileAsync(process.execPath, [script], {
        env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" },
      });
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code?: number; stderr?: string };
      return { code: failure.code ?? 1, stdout: failure.stderr ?? "" };
    }
  }

  const counts = async () => {
    const [users] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(user)
      .where(inArray(user.email, DEMO_EMAILS));
    const [subs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.provider, "seed"));
    const [txs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(sql`${creditTransactions.sourceId} like 'seed:%'`);
    const [orderRows] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.provider, "seed"));
    return {
      users: users!.n,
      subscriptions: subs!.n,
      transactions: txs!.n,
      orders: orderRows!.n,
    };
  };

  const clean = () => db.delete(user).where(inArray(user.email, DEMO_EMAILS));

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();

    client = createDbClient(url!);
    db = client.db;
  });

  afterAll(async () => {
    // 测试库是共用的：留下的演示用户会影响其他用例的列表断言，跑完就删。
    // 订阅、订单、积分流水都挂在 user 上（cascade），一起走。
    await clean();
    await client?.close();
  });

  test("空库跑一次：用户、订阅、订单、积分流水都有，账本自洽", async () => {
    await clean();

    const result = await seed();

    expect(result.code).toBe(0);
    expect(await counts()).toEqual({
      users: 2,
      subscriptions: 2,
      // demo 用户 4 条（1 发放 + 3 扣减）、churn 用户 2 条（1 发放 + 1 扣减）。
      transactions: 6,
      orders: 2,
    });

    const [demo] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.email, "demo@example.com"));
    expect(demo!.name).toBe("Demo User");

    // 余额等于流水之和（账本的不变式），演示数据也不能破。
    const [balance] = await db
      .select({ balance: userCredits.balance })
      .from(userCredits)
      .where(eq(userCredits.userId, demo!.id));
    const [sum] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, demo!.id));
    expect(balance!.balance).toBe(sum!.total);

    // dashboard 读的就是这两处：账单概览（订阅/已购）与积分流水。
    const overview = await getBillingOverview({ db, userId: demo!.id });
    expect(overview.subscription).toMatchObject({
      planId: "pro",
      status: "active",
    });
    const history = await listTransactions(demo!.id, { limit: 10, tx: db });
    expect(history).toHaveLength(4);

    // 后台用户列表能看到演示用户并带上余额。
    const listed = await listUsers(db, { query: "demo@example.com" });
    expect(listed.rows.map((row) => row.email)).toContain("demo@example.com");
    expect(listed.rows[0]!.balance).toBe(balance!.balance);
  });

  test("重复执行：不报错、不重复插入", async () => {
    const before = await counts();

    const result = await seed();

    expect(result.code).toBe(0);
    expect(await counts()).toEqual(before);
  });

  test("生产环境拒绝执行", async () => {
    const result = await execFileAsync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: "production" },
    }).then(
      () => ({ code: 0, stdout: "" }),
      (error: { code?: number; stderr?: string }) => ({
        code: error.code ?? 1,
        stdout: error.stderr ?? "",
      }),
    );

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("拒绝在生产环境灌演示数据");
  });
});
