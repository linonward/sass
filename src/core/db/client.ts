import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import ws from "ws";

import { driverFor } from "./driver";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DbClient = {
  db: Database;
  /** 关闭连接池。长驻进程不需要调用，测试和脚本结束时调用。 */
  close: () => Promise<void>;
};

export type DbClientOptions = {
  /** 会话时区，默认 UTC。只有测试会传别的值（复现非 UTC 会话下的时间偏移）。 */
  sessionTimezone?: string;
};

/**
 * 按地址选择驱动，创建 Drizzle 实例。只在第一次查询时才真正建立连接。
 *
 * **连接时把会话时区钉成 UTC。** 库里所有 `timestamp` 列都按 UTC 墙钟存取：
 * `defaultNow()` 写的是**会话时区**的墙钟，而 drizzle 的列映射读回来时按 UTC 解释
 * （无时区值 + `+0000`）。自建 Postgres 的服务器时区可能是本地时区（比如 +08），
 * 那 `defaultNow()` 写进去的时间读回来就整体偏移 8 小时 —— 视频任务的超时判定
 * （`ai_usage.created_at`）和后台统计窗口都会算错。Neon 本来就是 UTC，这里显式写出来
 * 是为了两条驱动行为一致，也让「服务器时区」不再是个需要买家自己确认的前提。
 *
 * 另一件不要做的事：**别在 raw `sql` 模板里插值 JS Date**。那种参数没有列上下文，
 * pg 会按**进程**本地时区序列化成带偏移的字面量，而 timestamp 列会忽略偏移只取墙钟。
 * 用 drizzle 的列表达式（`gte(列, date)` 之类），它们按列的映射器编码成 UTC。
 */
export function createDbClient(
  url: string,
  { sessionTimezone = "UTC" }: DbClientOptions = {},
): DbClient {
  if (!/^[A-Za-z0-9_+./-]+$/.test(sessionTimezone)) {
    throw new Error(`非法的会话时区：${sessionTimezone}`);
  }
  const options = `-c timezone=${sessionTimezone}`;
  if (driverFor(url) === "neon") {
    // Node 没有全局 WebSocket，需要显式指定。
    neonConfig.webSocketConstructor = ws;
    const pool = new NeonPool({ connectionString: url, options });
    return {
      db: drizzleNeon({ client: pool, schema }),
      close: () => pool.end(),
    };
  }
  const pool = new PgPool({ connectionString: url, options });
  return { db: drizzlePg({ client: pool, schema }), close: () => pool.end() };
}

/** db.transaction() 回调拿到的事务对象；需要参与调用方事务的函数接收它。 */
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
