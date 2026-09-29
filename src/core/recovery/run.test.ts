// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { jobLeases } from "@/core/db/schema";

import { acquireLease, releaseLease } from "./lease";
import { createRecoveryRunner } from "./run";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "跳过恢复运行器测试：未设置 DATABASE_URL_TEST（见 .env.example）",
  );
}

describe.skipIf(!url)("恢复运行器与租约", () => {
  let dbClient: DbClient;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    dbClient = createDbClient(url!);
  });

  afterAll(async () => {
    await dbClient?.close();
  });

  const leaseName = () => `test-${randomUUID()}`;

  test("并发抢同一把租约：只有一个抢到；放掉之后又能抢", async () => {
    const name = leaseName();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireLease(dbClient.db, { name, ttlMs: 60_000 }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(
      false,
    );
    await releaseLease(dbClient.db, name);
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
  });

  test("持有者死掉（没放）：租约到期后别人能接手", async () => {
    const name = leaseName();
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
    // 模拟过了 TTL：把到期时间拨回过去。
    await dbClient.db
      .update(jobLeases)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(eq(jobLeases.name, name));
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
  });

  test("限频：距上次开始不足最小间隔就不抢，锁已放掉也一样", async () => {
    const name = leaseName();
    const opts = { name, ttlMs: 60_000, minIntervalMs: 5 * 60_000 };
    expect(await acquireLease(dbClient.db, opts)).toBe(true);
    await releaseLease(dbClient.db, name);
    expect(await acquireLease(dbClient.db, opts)).toBe(false);
    // cron 不受限频：只看锁。
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
    await releaseLease(dbClient.db, name);
    await dbClient.db
      .update(jobLeases)
      .set({ lastStartedAt: sql`now() - interval '6 minutes'` })
      .where(eq(jobLeases.name, name));
    expect(await acquireLease(dbClient.db, opts)).toBe(true);
    const [row] = await dbClient.db
      .select()
      .from(jobLeases)
      .where(eq(jobLeases.name, name));
    expect(row!.lastFinishedAt).not.toBeNull();
  });

  test("运行器：抢到才跑，记结构化日志；一个任务出错不影响其它任务，也不会让租约挂着", async () => {
    const name = leaseName();
    const logInfo = vi.fn();
    const logError = vi.fn();
    const ai = vi.fn(async ({ limit }: { limit: number }) => ({
      scanned: limit,
      failed: 1,
    }));
    const broken = vi.fn(async () => {
      throw new Error("boom");
    });
    const run = createRecoveryRunner({
      db: () => dbClient.db,
      leaseName: name,
      tasks: { broken, ai },
      logInfo,
      logError,
    });

    const [first, second] = await Promise.all([
      run({ trigger: "cron", limit: 7 }),
      run({ trigger: "cron", limit: 7 }),
    ]);
    // 同时触发的两次里只有一次真的跑了（平台重复投递、调度器重叠都是这个形状）。
    expect([first.ran, second.ran].sort()).toEqual([false, true]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai).toHaveBeenCalledWith({ limit: 7 });
    const ran = first.ran ? first : second;
    expect(ran).toEqual({
      ran: true,
      trigger: "cron",
      results: { broken: { error: true }, ai: { scanned: 7, failed: 1 } },
    });
    expect(logInfo).toHaveBeenCalledWith("ai.recovery", {
      trigger: "cron",
      scanned: 7,
      failed: 1,
    });
    expect(logError).toHaveBeenCalledWith(
      "broken.recovery_failed",
      expect.objectContaining({ trigger: "cron" }),
    );

    // 租约已经放掉：cron 能立刻再跑；机会式的要等 5 分钟。
    expect((await run({ trigger: "opportunistic", limit: 3 })).ran).toBe(false);
    expect((await run({ trigger: "cron", limit: 7 })).ran).toBe(true);
  });
});
