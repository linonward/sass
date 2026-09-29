// @vitest-environment node
import { desc, gte, sql } from "drizzle-orm";
import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDbClient, type DbClient } from "./client";

const url = process.env.DATABASE_URL_TEST;

// Database is the common type of both drivers, so execute()'s result type is unknown; both drivers'
// results carry rows.
const rows = (result: unknown) => (result as { rows: unknown[] }).rows;

// Timestamp probe table: verifies timestamp columns are stored and read as UTC wall-clock time.
const tzProbe = pgTable("t1201_tz_probe", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
});

// CI must provide a test database; silently skipping is not allowed.
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping database tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

describe.skipIf(!url)("database", () => {
  let client: DbClient;
  // Each run uses its own table name so concurrent runs don't interfere.
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

  test("connects and runs a query", async () => {
    const result = await client.db.execute(sql`select 1 as ok`);
    expect(rows(result)).toEqual([{ ok: 1 }]);
  });

  test("rolls back writes when the transaction throws", async () => {
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

  test("commits writes when the transaction completes", async () => {
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`insert into ${table} (note) values ('committed')`);
    });
    const result = await client.db.execute(sql`select note from ${table}`);
    expect(rows(result)).toEqual([{ note: "committed" }]);
  });

  test("session time zone is forced to UTC: defaultNow round-trips, Date params compare consistently", async () => {
    expect(
      (
        rows(await client.db.execute(sql`show timezone`))[0] as {
          TimeZone: string;
        }
      ).TimeZone,
    ).toBe("UTC");

    // One row gets its time from defaultNow() (database side), one from a JS Date (client side).
    const before = Date.now();
    await client.db.insert(tzProbe).values({ updatedAt: new Date(before) });
    const [row] = await client.db
      .select()
      .from(tzProbe)
      .orderBy(desc(tzProbe.id));
    expect(Math.abs(row!.createdAt.getTime() - before)).toBeLessThan(5000);
    expect(Math.abs(row!.updatedAt.getTime() - before)).toBeLessThan(5000);

    // A JS Date parameter in a comparison is encoded as UTC by the column's mapper (column
    // expressions like `gte(column, date)`). The parameter is 5 seconds ago so the test doesn't
    // depend on millisecond clock alignment between the database and the test process.
    const hits = await client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tzProbe)
      .where(gte(tzProbe.createdAt, new Date(Date.now() - 5_000)));
    expect(hits[0]!.n).toBeGreaterThan(0);
  });

  test("a non-UTC session skews defaultNow — which is why the client forces UTC", async () => {
    const c = createDbClient(url!, { sessionTimezone: "Asia/Shanghai" });
    try {
      const before = Date.now();
      await c.db.insert(tzProbe).values({ updatedAt: new Date(before) });
      const [row] = await c.db
        .select()
        .from(tzProbe)
        .orderBy(desc(tzProbe.id))
        .limit(1);

      // With a +8 session time zone, defaultNow() writes the +8 wall clock, which reads back as
      // UTC 8 hours off (exactly what happens when a self-hosted Postgres server isn't set to UTC).
      expect(
        Math.abs(row!.createdAt.getTime() - before - 8 * 3_600_000),
      ).toBeLessThan(60_000);
      // Client-written timestamps are unaffected by the session time zone: drizzle's mapper
      // encodes them as UTC.
      expect(Math.abs(row!.updatedAt.getTime() - before)).toBeLessThan(5000);
    } finally {
      await c.close();
    }
  });
});
