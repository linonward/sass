#!/usr/bin/env node
/**
 * 灌一批演示数据：两个示例用户、一条订阅、两笔订单、一份积分流水。
 *
 * 用法：ALLOW_DB_SEED=1 pnpm db:seed
 *      ALLOW_DB_SEED=1 DATABASE_URL=postgres://… pnpm db:seed
 *
 * 给「刚 clone 下来想看看有数据长什么样」用：空库里 dashboard 一片空，跑完这个就有东西可看。
 * 幂等：所有写入都按自然键 upsert / 不覆盖已有值，重复执行不会报错也不会多出数据。
 *
 * 演示数据挂在 demo-*@example.com 这两个邮箱下，想清掉直接删用户（外键是 cascade）：
 *   delete from "user" where email like 'demo-%@example.com';
 *
 * 闸门：生产环境拒绝执行（演示数据不该出现在真实站点里）。判断口径和 src/core/billing/env.ts
 * 的 fakeBillingAllowed 一致 —— **NODE_ENV 没设置时按生产处理**，只有
 * NODE_ENV=development / test，或者显式 ALLOW_DB_SEED=1 才放行。
 * 闸门收紧前是 `NODE_ENV === "production"` 才拒绝，于是直接敲
 * `DATABASE_URL=… node scripts/db-seed.mjs`（shell 里没设 NODE_ENV）就会把演示数据
 * 灌进它指向的库，包括生产库。
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
    // 订阅：已用掉一段账期，20 天后续费。
    subscription: {
      id: "seed-sub-demo",
      status: "active",
      periodStartDays: -10,
      periodEndDays: 20,
    },
    credits: {
      // 余额必须等于流水之和（账本的不变式），下面几条流水加起来正好是 1730。
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
    // 已取消但还没到期的订阅：后台里能看到 canceledAt 与 currentPeriodEnd。
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

// 先读 .env.local 再判断环境：顺序和 scripts/admin-demote.mjs 一致，免得
// `.env.local` 里写了 NODE_ENV=production 时被这条闸门漏过去。
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// 只有 development / test 算非生产运行时，名单和 src/core/billing/env.ts 的
// nonProductionNodeEnvs 一致（脚本是 .mjs，import 不了 TS）。
const nonProductionNodeEnvs = ["development", "test"];
// `ALLOW_DB_SEED` 的合法取值：只有 1 / true 放行，0 / false 与不填等价。
const seedOptInValues = ["1", "true", "0", "false"];

const nodeEnv = process.env.NODE_ENV;
const optInValue = process.env.ALLOW_DB_SEED;
const optIn = optInValue === "1" || optInValue === "true";
// NODE_ENV 没设置时按生产处理（nodeEnv 未定义 → 不是非生产运行时）：
// `next build` / `next start`、Docker、以及直接敲脚本的裸 shell 命令都没设 NODE_ENV，宁可拒绝。
const nonProductionRuntime =
  nodeEnv !== undefined && nonProductionNodeEnvs.includes(nodeEnv);

if (!nonProductionRuntime && !optIn) {
  fail(
    [
      `拒绝灌演示数据：NODE_ENV=${nodeEnv ?? "（未设置）"}，按生产处理。`,
      // 写成 ALLOW_DB_SEED=yes 时会走到这里，顺手点出来，别让人对着「明明设了」发呆。
      optInValue !== undefined && !seedOptInValues.includes(optInValue)
        ? `ALLOW_DB_SEED=${optInValue} 不是有效值（只认 1 / true 放行，0 / false 关闭）。`
        : null,
      "演示数据只该灌进独立的库：示例用户是 email_verified=true 的 example.com 保留域邮箱，",
      "收不到验证码也接管不了，订阅/订单/积分流水却会真实计入 admin 后台、指标和收入统计。",
      "确认 DATABASE_URL 指向的不是生产库后，任选一种方式放行：",
      "  ALLOW_DB_SEED=1 pnpm db:seed",
      "  NODE_ENV=development pnpm db:seed",
      // 已经灌进真实库时的补救手段。
      "清掉已灌进去的数据：delete from \"user\" where email like 'demo-%@example.com';",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    "缺少 DATABASE_URL：先配好 .env.local，或用 `ALLOW_DB_SEED=1 DATABASE_URL=… pnpm db:seed`。",
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("begin");

  for (const user of DEMO_USERS) {
    // 邮箱已存在时只更新名字（沿用已有 id），不覆盖其他字段。
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

    // 余额只在用户还没有余额记录时写入，不覆盖真实余额。
    await client.query(
      `insert into user_credits (user_id, balance, updated_at)
       values ($1, $2, now())
       on conflict (user_id) do nothing`,
      [userId, user.credits.balance],
    );

    for (const entry of user.credits.entries) {
      // id 交给数据库生成（这一列是 uuid），幂等靠 (source, source_id)。
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
  `演示数据就绪：${DEMO_USERS.length} 个用户、${ORDERS.length} 笔订单、2 条订阅、若干积分流水。`,
);
console.log(
  "用 demo@example.com 登录（验证码会打到终端或邮件）就能看到填满数据的 dashboard。",
);
console.log(
  "清掉它们：delete from \"user\" where email like 'demo-%@example.com';",
);
