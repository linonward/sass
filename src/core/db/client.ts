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

/** 按地址选择驱动，创建 Drizzle 实例。只在第一次查询时才真正建立连接。 */
export function createDbClient(url: string): DbClient {
  if (driverFor(url) === "neon") {
    // Node 没有全局 WebSocket，需要显式指定。
    neonConfig.webSocketConstructor = ws;
    const pool = new NeonPool({ connectionString: url });
    return {
      db: drizzleNeon({ client: pool, schema }),
      close: () => pool.end(),
    };
  }
  const pool = new PgPool({ connectionString: url });
  return { db: drizzlePg({ client: pool, schema }), close: () => pool.end() };
}
