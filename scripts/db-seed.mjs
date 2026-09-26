#!/usr/bin/env node
/**
 * 灌一批演示数据：两个示例用户、一条订阅、两笔订单、一份积分流水。
 *
 * 用法：pnpm db:seed
 *      DATABASE_URL=postgres://… pnpm db:seed
 *
 * 给「刚 clone 下来想看看有数据长什么样」用：空库里 dashboard 一片空，跑完这个就有东西可看。
 * 幂等：所有写入都按自然键 upsert / 不覆盖已有值，重复执行不会报错也不会多出数据。
 *
 * 演示数据挂在 demo-*@example.com 这两个邮箱下，想清掉直接删用户（外键是 cascade）：
 *   delete from "user" where email like 'demo-%@example.com';
 *
 * 生产环境拒绝执行：演示数据不该出现在真实站点里。
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

if (process.env.NODE_ENV === "production") {
  fail("拒绝在生产环境灌演示数据。真要演示请用一个独立的库。");
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    "缺少 DATABASE_URL：先配好 .env.local，或用 `DATABASE_URL=… pnpm db:seed`。",
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
