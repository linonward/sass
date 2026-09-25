// @vitest-environment node
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "./client";

const url = process.env.DATABASE_URL_TEST;

// Database 是两种驱动的公共类型，execute() 的结果类型未知；两种驱动的结果都带 rows。
const rows = (result: unknown) => (result as { rows: unknown[] }).rows;

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
  });

  afterAll(async () => {
    await client.db.execute(sql`drop table if exists ${table}`);
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
});
