import { env } from "@/core/env";

import { createDbClient, type Database } from "./client";

export type { Database, DbTransaction } from "./client";

let client: ReturnType<typeof createDbClient> | undefined;

/**
 * Lazily created global connection. Importing this module doesn't connect to the database, and
 * `next build` doesn't need a reachable database.
 */
export function getDb(): Database {
  client ??= createDbClient(env.DATABASE_URL);
  return client.db;
}

/** Same as getDb(), so you can write `db.select()...` directly. */
export const db = new Proxy({} as Database, {
  get(_, property) {
    const target = getDb();
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
