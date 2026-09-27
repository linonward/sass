// @vitest-environment node
import { desc, gte, sql } from "drizzle-orm";
import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "./client";

const url = process.env.DATABASE_URL_TEST;

// Database 是两种驱动的公共类型，execute() 的结果类型未知；两种驱动的结果都带 rows。
const rows = (result: unknown) => (result as { rows: unknown[] }).rows;

// 时间列探针表：验证 timestamp 列按 UTC 墙钟存取。
const tzProbe = pgTable("t1201_tz_probe", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
});

// CI 必须提供测试库，不允许静默跳过。
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过数据库测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

describe.skipIf(!url)("数据库", () => {
  let client: DbClient;
  // 每次运行用独立的表名，避免并发运行互相影响。
  const table = sql.identifier(`t201_rollback_${Date.now()}`);

  beforeAll(async () => {
    client = createDbClient(url!);
    await client.db.execute(
      sql`create table ${table} (id serial primary key, note text not null)`,
    );
    await client.db.execute(sql`drop table if exists t1201_tz_probe`);
    await client.db.execute(
      sql`create table t1201_tz_probe (id serial primary key, created_at timestamp not null default now(), updated_at timestamp not null)`,
    );
  });

  afterAll(async () => {
    await client.db.execute(sql`drop table if exists ${table}`);
    await client.db.execute(sql`drop table if exists t1201_tz_probe`);
    await client.close();
  });

  test("可以连通并执行查询", async () => {
    const result = await client.db.execute(sql`select 1 as ok`);
    expect(rows(result)).toEqual([{ ok: 1 }]);
  });

  test("事务内抛错时，写入被回滚", async () => {
    await expect(
      client.db.transaction(async (tx) => {
        await tx.execute(
          sql`insert into ${table} (note) values ('rolled back')`,
        );
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    const result = await client.db.execute(
      sql`select count(*)::int as count from ${table}`,
    );
    expect(rows(result)).toEqual([{ count: 0 }]);
  });

  test("事务正常结束时，写入被提交", async () => {
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`insert into ${table} (note) values ('committed')`);
    });
    const result = await client.db.execute(sql`select note from ${table}`);
    expect(rows(result)).toEqual([{ note: "committed" }]);
  });

  test("会话时区被强制为 UTC：defaultNow 写读一致，Date 参数比较一致", async () => {
    expect(
      (
        rows(await client.db.execute(sql`show timezone`))[0] as {
          TimeZone: string;
        }
      ).TimeZone,
    ).toBe("UTC");

    // 一行由 defaultNow() 落时间（数据库侧），一行由 JS Date 落时间（客户端侧）。
    const before = Date.now();
    await client.db.insert(tzProbe).values({ updatedAt: new Date(before) });
    const [row] = await client.db
      .select()
      .from(tzProbe)
      .orderBy(desc(tzProbe.id));
    expect(Math.abs(row!.createdAt.getTime() - before)).toBeLessThan(5000);
    expect(Math.abs(row!.updatedAt.getTime() - before)).toBeLessThan(5000);

    // JS Date 参数参与比较时会按列的映射器编码成 UTC（`gte(列, date)` 这类列表达式）；
    // 参数取 5 秒前，不依赖数据库与测试进程的毫秒级时钟对齐。
    const hits = await client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tzProbe)
      .where(gte(tzProbe.createdAt, new Date(Date.now() - 5_000)));
    expect(hits[0]!.n).toBeGreaterThan(0);
  });

  test("非 UTC 会话会让 defaultNow 读偏 —— 这就是客户端强制 UTC 的原因", async () => {
    const c = createDbClient(url!, { sessionTimezone: "Asia/Shanghai" });
    try {
      const before = Date.now();
      await c.db.insert(tzProbe).values({ updatedAt: new Date(before) });
      const [row] = await c.db
        .select()
        .from(tzProbe)
        .orderBy(desc(tzProbe.id))
        .limit(1);

      // 会话时区 +8 时 defaultNow() 写的是 +8 墙钟，按 UTC 读回就偏了 8 小时
      // （自建 Postgres 的服务器时区没配成 UTC 就是这个后果）。
      expect(
        Math.abs(row!.createdAt.getTime() - before - 8 * 3_600_000),
      ).toBeLessThan(60_000);
      // 客户端写的时间戳不受会话时区影响：drizzle 的映射器编码成 UTC。
      expect(Math.abs(row!.updatedAt.getTime() - before)).toBeLessThan(5000);
    } finally {
      await c.close();
    }
  });
});
