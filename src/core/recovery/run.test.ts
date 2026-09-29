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
    "Skipping recovery runner tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

describe.skipIf(!url)("recovery runner and lease", () => {
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

  test("concurrent acquires of one lease: only one wins; after release it can be acquired again", async () => {
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

  test("holder dies without releasing: someone else can take over after the lease expires", async () => {
    const name = leaseName();
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
    // Simulate the TTL passing: move the expiry into the past.
    await dbClient.db
      .update(jobLeases)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(eq(jobLeases.name, name));
    expect(await acquireLease(dbClient.db, { name, ttlMs: 60_000 })).toBe(true);
  });

  test("rate limit: no acquire within the minimum interval since the last start, even if the lock was released", async () => {
    const name = leaseName();
    const opts = { name, ttlMs: 60_000, minIntervalMs: 5 * 60_000 };
    expect(await acquireLease(dbClient.db, opts)).toBe(true);
    await releaseLease(dbClient.db, name);
    expect(await acquireLease(dbClient.db, opts)).toBe(false);
    // cron isn't rate-limited: only the lock matters.
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

  test("runner: runs only when it gets the lease and writes structured logs; one failing task does not affect the others or leave the lease held", async () => {
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
    // Of two simultaneous triggers only one actually runs (duplicate platform deliveries and
    // overlapping schedulers look exactly like this).
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

    // The lease has been released: cron can run again right away; opportunistic has to wait 5
    // minutes.
    expect((await run({ trigger: "opportunistic", limit: 3 })).ran).toBe(false);
    expect((await run({ trigger: "cron", limit: 7 })).ran).toBe(true);
  });
});
