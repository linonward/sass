// @vitest-environment node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { listUsers } from "@/core/admin/queries";
import { getBillingOverview } from "@/core/billing/overview";
import { listTransactions } from "@/core/credits";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  creditTransactions,
  orders,
  subscriptions,
  user,
  userCredits,
} from "@/core/db/schema";

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL_TEST;

// CI must provide a test database; silently skipping is not allowed.
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping demo data tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

const DEMO_EMAILS = ["demo@example.com", "demo-churn@example.com"];

describe.skipIf(!url)("scripts/db-seed.mjs", () => {
  let client: DbClient;
  let db: DbClient["db"];

  const script = path.resolve(__dirname, "../../../scripts/db-seed.mjs");

  /**
   * Runs the script. Passes `NODE_ENV=test` by default — the script treats "NODE_ENV unset" as
   * production and refuses without it.
   * Keys in `env` whose value is undefined are removed from the child process environment, to test
   * the "unset" cases.
   */
  async function seed(env: Record<string, string | undefined> = {}) {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: "test",
      ALLOW_DB_SEED: undefined,
      ...env,
    };
    for (const [key, value] of Object.entries(childEnv)) {
      if (value === undefined) delete childEnv[key];
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, [script], {
        // Keys were deleted above, so NODE_ENV may be gone (the ProcessEnv type requires it); assert it back.
        env: childEnv as NodeJS.ProcessEnv,
      });
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code?: number; stderr?: string };
      return { code: failure.code ?? 1, stdout: failure.stderr ?? "" };
    }
  }

  const counts = async () => {
    const [users] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(user)
      .where(inArray(user.email, DEMO_EMAILS));
    const [subs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.provider, "seed"));
    const [txs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(sql`${creditTransactions.sourceId} like 'seed:%'`);
    const [orderRows] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.provider, "seed"));
    return {
      users: users!.n,
      subscriptions: subs!.n,
      transactions: txs!.n,
      orders: orderRows!.n,
    };
  };

  const clean = () => db.delete(user).where(inArray(user.email, DEMO_EMAILS));

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();

    client = createDbClient(url!);
    db = client.db;
  });

  afterAll(async () => {
    // The test database is shared: leftover demo users would affect other tests' list assertions, so
    // delete them afterwards.
    // Subscriptions, orders and credit transactions all hang off the user (cascade) and go with it.
    await clean();
    await client?.close();
  });

  test("one run on an empty database: users, subscriptions, orders and credit transactions exist and the ledger is consistent", async () => {
    await clean();

    const result = await seed();

    expect(result.code).toBe(0);
    expect(await counts()).toEqual({
      users: 2,
      subscriptions: 2,
      // 4 for the demo user (1 grant + 3 deductions), 2 for the churn user (1 grant + 1 deduction).
      transactions: 6,
      orders: 2,
    });

    const [demo] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.email, "demo@example.com"));
    expect(demo!.name).toBe("Demo User");

    // Balance equals the sum of transactions (the ledger invariant); demo data must not break it either.
    const [balance] = await db
      .select({ balance: userCredits.balance })
      .from(userCredits)
      .where(eq(userCredits.userId, demo!.id));
    const [sum] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, demo!.id));
    expect(balance!.balance).toBe(sum!.total);

    // These are exactly what the dashboard reads: the billing overview (subscriptions / purchases) and
    // credit transactions.
    const overview = await getBillingOverview({ db, userId: demo!.id });
    expect(overview.subscription).toMatchObject({
      planId: "pro",
      status: "active",
    });
    const history = await listTransactions(demo!.id, { limit: 10, tx: db });
    expect(history).toHaveLength(4);

    // The admin user list shows the demo users with their balances.
    const listed = await listUsers(db, { query: "demo@example.com" });
    expect(listed.rows.map((row) => row.email)).toContain("demo@example.com");
    expect(listed.rows[0]!.balance).toBe(balance!.balance);
  });

  test("running again: no errors and no duplicate inserts", async () => {
    const before = await counts();

    const result = await seed();

    expect(result.code).toBe(0);
    expect(await counts()).toEqual(before);
  });

  test("refuses to run in production", async () => {
    const result = await seed({ NODE_ENV: "production" });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("Refusing to seed demo data");
  });

  test("NODE_ENV unset: refuses as production and writes nothing", async () => {
    await clean();

    const result = await seed({ NODE_ENV: undefined });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("Refusing to seed demo data");
    // When refusing, it must say how to allow it; otherwise people have to read the source to guess
    // ("use a separate database" alone is not enough).
    expect(result.stdout).toContain("ALLOW_DB_SEED=1 pnpm db:seed");
    expect(await counts()).toEqual({
      users: 0,
      subscriptions: 0,
      transactions: 0,
      orders: 0,
    });
  });

  test("ALLOW_DB_SEED=1 explicitly allows it: seeds normally even with NODE_ENV unset", async () => {
    await clean();

    const result = await seed({ NODE_ENV: undefined, ALLOW_DB_SEED: "1" });

    expect(result.code).toBe(0);
    expect(await counts()).toEqual({
      users: 2,
      subscriptions: 2,
      transactions: 6,
      orders: 2,
    });
  });
});
