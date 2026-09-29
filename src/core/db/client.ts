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
  /** Closes the pool. Long-running processes don't need it; tests and scripts call it when done. */
  close: () => Promise<void>;
};

export type DbClientOptions = {
  /**
   * Session time zone, UTC by default. Only tests pass anything else (to reproduce the time shift
   * under a non-UTC session).
   */
  sessionTimezone?: string;
};

/**
 * Picks a driver based on the URL and creates a Drizzle instance. The connection is only opened on
 * the first query.
 *
 * **The session time zone is pinned to UTC on connect.** Every `timestamp` column in the database
 * is stored and read as UTC wall-clock time: `defaultNow()` writes the wall clock of the **session
 * time zone**, while drizzle's column mapping interprets values read back as UTC (a zone-less
 * value + `+0000`). A self-hosted Postgres server may run in a local time zone (say +08), and then
 * times written by `defaultNow()` read back shifted by 8 hours — the video job timeout check
 * (`ai_usage.created_at`) and the admin stats windows would all be wrong. Neon is UTC anyway;
 * spelling it out here keeps both drivers consistent and removes "server time zone" as a
 * precondition buyers have to verify themselves.
 *
 * One more thing not to do: **don't interpolate a JS Date into a raw `sql` template.** Such a
 * parameter has no column context, so pg serializes it as an offset literal in the **process's**
 * local time zone, and timestamp columns ignore the offset and keep only the wall clock. Use
 * drizzle column expressions (`gte(column, date)` and the like), which encode through the column's
 * mapper as UTC.
 */
export function createDbClient(
  url: string,
  { sessionTimezone = "UTC" }: DbClientOptions = {},
): DbClient {
  if (!/^[A-Za-z0-9_+./-]+$/.test(sessionTimezone)) {
    throw new Error(`Invalid session time zone: ${sessionTimezone}`);
  }
  const options = `-c timezone=${sessionTimezone}`;
  if (driverFor(url) === "neon") {
    // Node has no global WebSocket, so it must be provided explicitly.
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

/**
 * The transaction object passed to the db.transaction() callback; functions that need to join the
 * caller's transaction accept it.
 */
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
