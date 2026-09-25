import { env } from "@/core/env";

import { createDbClient, type Database } from "./client";

export type { Database } from "./client";

let client: ReturnType<typeof createDbClient> | undefined;

/** 惰性创建的全局连接。import 本模块不会连接数据库，next build 时也不需要可用的数据库。 */
export function getDb(): Database {
  client ??= createDbClient(env.DATABASE_URL);
  return client.db;
}

/** 等同于 getDb()，方便直接写 `db.select()...`。 */
export const db = new Proxy({} as Database, {
  get(_, property) {
    const target = getDb();
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
