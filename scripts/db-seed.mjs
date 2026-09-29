#!/usr/bin/env node
/**
 * Seeds demo data: two sample users, their subscriptions, two orders and a set of credit
 * transactions.
 *
 * Usage: ALLOW_DB_SEED=1 pnpm db:seed
 *        ALLOW_DB_SEED=1 DATABASE_URL=postgres://… pnpm db:seed
 *
 * For "I just cloned this and want to see what it looks like with data": on an empty database the
 * dashboard is blank; after running this there is something to look at.
 * Idempotent: every write is an upsert on a natural key / never overwrites existing values, so
 * rerunning neither errors nor adds duplicate data.
 *
 * The demo data hangs off the demo-*@example.com emails; to clear it, delete the users (foreign
 * keys cascade):
 *   delete from "user" where email like 'demo-%@example.com';
 *
 * Gate: refuses to run in production (demo data must not show up on a real site). The rule matches
 * fakeBillingAllowed in src/core/billing/env.ts — **an unset NODE_ENV counts as production**; only
 * NODE_ENV=development / test, or an explicit ALLOW_DB_SEED=1, lets it through.
 * Before the gate was tightened it only refused on `NODE_ENV === "production"`, so typing
 * `DATABASE_URL=… node scripts/db-seed.mjs` (no NODE_ENV in the shell) would seed demo data into
 * whatever database it pointed at, production included.
 */
import { existsSync } from "node:fs";
import process from "node:process";

import pg from "pg";

const DEMO_USERS = [
  {
    id: "seed-user-demo",
    email: "demo@example.com",
    name: "Demo User",
    planId: "pro",
    // Subscription: partway through the billing period, renews in 20 days.
    subscription: {
      id: "seed-sub-demo",
      status: "active",
      periodStartDays: -10,
      periodEndDays: 20,
    },
    credits: {
      // The balance must equal the sum of the transactions (the ledger invariant); the entries below
      // add up to exactly 1730.
      balance: 1730,
      entries: [
        {
          id: "seed-tx-grant-1",
          type: "grant",
          amount: 2000,
          reason: "Purchase of pro (seed)",
          source: "billing",
          sourceId: "seed:order:seed-order-demo-1",
        },
        {
          id: "seed-tx-deduct-1",
          type: "deduct",
          amount: -50,
          reason: "AI text · deepseek (seed)",
          source: "ai",
          sourceId: "seed:ai:1",
        },
        {
          id: "seed-tx-deduct-2",
          type: "deduct",
          amount: -120,
          reason: "AI image · qwen-image (seed)",
          source: "ai",
          sourceId: "seed:ai:2",
        },
        {
          id: "seed-tx-deduct-3",
          type: "deduct",
          amount: -100,
          reason: "AI video · wan-t2v (seed)",
          source: "ai",
          sourceId: "seed:ai:3",
        },
      ],
    },
  },
  {
    id: "seed-user-churn",
    email: "demo-churn@example.com",
    name: "Demo Churn",
    planId: "pro",
    // A canceled subscription that hasn't expired yet: admin shows canceledAt and currentPeriodEnd.
    subscription: {
      id: "seed-sub-churn",
      status: "canceled",
      periodStartDays: -25,
      periodEndDays: 5,
      canceledDays: -3,
    },
    credits: {
      balance: 300,
      entries: [
        {
          id: "seed-tx-grant-2",
          type: "grant",
          amount: 2000,
          reason: "Purchase of pro (seed)",
          source: "billing",
          sourceId: "seed:order:seed-order-churn-1",
        },
        {
          id: "seed-tx-deduct-4",
          type: "deduct",
          amount: -1700,
          reason: "AI text · qwen-max (seed)",
          source: "ai",
          sourceId: "seed:ai:4",
        },
      ],
    },
  },
];

const ORDERS = [
  {
    id: "seed-order-demo-1",
    orderId: "seed-order-demo-1",
    userId: "seed-user-demo",
    subscriptionId: "seed-sub-demo",
    status: "paid",
    amount: 1900,
    refunded: 0,
    daysAgo: 10,
  },
  {
    id: "seed-order-churn-1",
    orderId: "seed-order-churn-1",
    userId: "seed-user-churn",
    subscriptionId: "seed-sub-churn",
    status: "paid",
    amount: 1900,
    refunded: 0,
    daysAgo: 25,
  },
];

const PROVIDER = "seed";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);

// Load .env.local before checking the environment: same order as scripts/admin-demote.mjs, so a
// NODE_ENV=production in `.env.local` can't slip past this gate.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Only development / test count as non-production runtimes; the list matches nonProductionNodeEnvs
// in src/core/billing/env.ts (this script is .mjs and can't import TS).
const nonProductionNodeEnvs = ["development", "test"];
// Valid values of `ALLOW_DB_SEED`: only 1 / true let it through; 0 / false are the same as unset.
const seedOptInValues = ["1", "true", "0", "false"];

const nodeEnv = process.env.NODE_ENV;
const optInValue = process.env.ALLOW_DB_SEED;
const optIn = optInValue === "1" || optInValue === "true";
// An unset NODE_ENV counts as production (nodeEnv undefined → not a non-production runtime):
// `next build` / `next start`, Docker, and bare shell commands running the script all leave NODE_ENV
// unset, so refusing is the safer choice.
const nonProductionRuntime =
  nodeEnv !== undefined && nonProductionNodeEnvs.includes(nodeEnv);

if (!nonProductionRuntime && !optIn) {
  fail(
    [
      `Refusing to seed demo data: NODE_ENV=${nodeEnv ?? "(unset)"}, treated as production.`,
      // ALLOW_DB_SEED=yes ends up here; point it out so nobody stares at "but I did set it".
      optInValue !== undefined && !seedOptInValues.includes(optInValue)
        ? `ALLOW_DB_SEED=${optInValue} is not a valid value (only 1 / true allow it, 0 / false disable it).`
        : null,
      "Demo data belongs only in a separate database: the sample users are email_verified=true addresses on the reserved example.com domain,",
      "which can't receive verification codes and can't be taken over, yet their subscriptions/orders/credit transactions count toward the admin, metrics and revenue figures.",
      "After confirming DATABASE_URL does not point at production, allow it either way:",
      "  ALLOW_DB_SEED=1 pnpm db:seed",
      "  NODE_ENV=development pnpm db:seed",
      // The remedy if it already went into a real database.
      "To clear seeded data: delete from \"user\" where email like 'demo-%@example.com';",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    "Missing DATABASE_URL: set up .env.local first, or run `ALLOW_DB_SEED=1 DATABASE_URL=… pnpm db:seed`.",
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("begin");

  for (const user of DEMO_USERS) {
    // If the email already exists, only update the name (keeping the existing id); don't overwrite
    // other fields.
    const { rows } = await client.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())
       on conflict (email) do update set name = excluded.name, updated_at = now()
       returning id`,
      [user.id, user.name, user.email],
    );
    const userId = rows[0].id;

    const subscription = user.subscription;
    await client.query(
      `insert into subscriptions
         (id, user_id, provider, provider_subscription_id, plan_id, status,
          current_period_start, current_period_end, canceled_at, last_event_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), now())
       on conflict (provider, provider_subscription_id) do nothing`,
      [
        subscription.id,
        userId,
        PROVIDER,
        subscription.id,
        user.planId,
        subscription.status,
        daysFromNow(subscription.periodStartDays),
        daysFromNow(subscription.periodEndDays),
        subscription.canceledDays
          ? daysFromNow(subscription.canceledDays)
          : null,
      ],
    );

    // Only write the balance when the user has no balance row yet; never overwrite a real balance.
    await client.query(
      `insert into user_credits (user_id, balance, updated_at)
       values ($1, $2, now())
       on conflict (user_id) do nothing`,
      [userId, user.credits.balance],
    );

    for (const entry of user.credits.entries) {
      // Let the database generate the id (the column is a uuid); idempotency comes from
      // (source, source_id).
      await client.query(
        `insert into credit_transactions
           (user_id, type, amount, reason, source, source_id, created_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (source, source_id) do nothing`,
        [
          userId,
          entry.type,
          entry.amount,
          entry.reason,
          entry.source,
          entry.sourceId,
        ],
      );
    }
  }

  for (const order of ORDERS) {
    const userId = DEMO_USERS.find((user) => user.id === order.userId).id;
    await client.query(
      `insert into orders
         (id, user_id, provider, provider_order_id, provider_subscription_id,
          plan_id, status, amount, currency, refunded_amount, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'pro', $6, $7, 'USD', $8, $9, now())
       on conflict (provider, provider_order_id) do nothing`,
      [
        order.id,
        userId,
        PROVIDER,
        order.orderId,
        order.subscriptionId,
        order.status,
        order.amount,
        order.refunded,
        daysFromNow(-order.daysAgo),
      ],
    );
  }

  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}

console.log(
  `Demo data ready: ${DEMO_USERS.length} users, ${ORDERS.length} orders, 2 subscriptions, and a set of credit transactions.`,
);
console.log(
  "Sign in as demo@example.com (the verification code goes to the terminal or email) to see a dashboard full of data.",
);
console.log(
  "To clear it: delete from \"user\" where email like 'demo-%@example.com';",
);
