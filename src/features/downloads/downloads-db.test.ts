// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { handleBillingEvent } from "@/core/billing/handle-event";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "@/core/billing/on-billing-event";
import { FakeProvider } from "@/core/billing/testing/fake-provider";
import { createDbClient, type DbClient } from "@/core/db/client";
import { pendingNotifications, user } from "@/core/db/schema";

import { createDownloadsHandler } from "./grant";
import { findDownload, listDownloads } from "./queries";
import { downloadEntitlements, downloadReleases } from "./schema";

// 真库测试：授权的唯一约束、和事件同事务提交的 outbox、退款收回，只有连着 Postgres 才测得准。
// 没有 DATABASE_URL_TEST 时跳过；CI 里必须配。
const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) throw new Error("DATABASE_URL_TEST required");

const config = {
  enabled: true,
  products: [{ id: "template", planId: "lifetime", updateMonths: 12 }],
};

describe.skipIf(!url)("downloads（真实 Postgres）", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let fake: FakeProvider;
  let userId: string;
  const sent: { template: string; props: Record<string, unknown> }[] = [];
  // 每个用例一个产品 id，发布的版本互不串（版本表不挂在用户上）。
  let productId: string;

  function useHandler(overrides: Partial<typeof config> = {}) {
    resetOnBillingEvent();
    registerOnBillingEvent(
      "downloads:grant",
      createDownloadsHandler({
        config: {
          ...config,
          products: [{ id: productId, planId: "lifetime", updateMonths: 12 }],
          ...overrides,
        },
        db,
        send: async (message) => {
          sent.push(message as (typeof sent)[number]);
        },
      }),
    );
  }

  const handle = (event: Parameters<typeof handleBillingEvent>[0]) =>
    handleBillingEvent(event, { db });
  const entitlements = () =>
    db
      .select()
      .from(downloadEntitlements)
      .where(eq(downloadEntitlements.userId, userId));
  const outbox = () =>
    db
      .select()
      .from(pendingNotifications)
      .where(eq(pendingNotifications.userId, userId));
  const buy = (orderId: string, extra: Record<string, unknown> = {}) =>
    fake.event("checkout.completed", {
      userId,
      checkoutId: "chk",
      orderId,
      planId: "lifetime",
      amount: 9900,
      currency: "USD",
      occurredAt: new Date("2026-09-30T00:00:00Z"),
      ...extra,
    });

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
    resetOnBillingEvent();
    await client?.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    fake = new FakeProvider();
    userId = `u_${randomUUID()}`;
    productId = `p${randomUUID().replaceAll("-", "")}`;
    await db.insert(user).values({
      id: userId,
      name: "Ada",
      email: `dl-${randomUUID().slice(0, 8)}@example.com`,
      emailVerified: true,
    });
    useHandler();
  });

  test("买了对应套餐：记一条授权（更新期 12 个月），发一封 download-ready", async () => {
    const orderId = `ord_${randomUUID()}`;
    await handle(buy(orderId));

    const [row] = await entitlements();
    expect(row).toMatchObject({
      productId,
      provider: fake.id,
      orderId,
      revokedAt: null,
    });
    expect(row!.updatesUntil.toISOString()).toBe("2027-09-30T00:00:00.000Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      template: "download-ready",
      props: {
        downloadsUrl: expect.stringMatching(/\/downloads$/),
        updatesUntil: "2027-09-30T00:00:00.000Z",
      },
    });
    expect((await outbox()).map((r) => r.status)).toEqual(["sent"]);
  });

  test("同一笔订单换个事件 ID 再推一次：不多授权、不多发信", async () => {
    const orderId = `ord_${randomUUID()}`;
    await handle(buy(orderId));
    await handle(buy(orderId));
    expect(await entitlements()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  test("别的套餐、订阅结账、模块关闭：都不授权", async () => {
    await handle(buy(`ord_${randomUUID()}`, { planId: "pro" }));
    await handle(
      buy(`ord_${randomUUID()}`, { subscriptionId: `sub_${randomUUID()}` }),
    );
    useHandler({ enabled: false });
    await handle(buy(`ord_${randomUUID()}`));
    expect(await entitlements()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  test("全额退款收回授权；部分退款不动", async () => {
    const partial = `ord_${randomUUID()}`;
    const full = `ord_${randomUUID()}`;
    await handle(buy(partial));
    await handle(buy(full));
    const refund = (orderId: string, amount: number) =>
      fake.event("refund.created", {
        userId,
        orderId,
        refundId: `ref_${randomUUID()}`,
        amount,
        currency: "USD",
      });
    await handle(refund(partial, 1000));
    await handle(refund(full, 9900));

    const byOrder = Object.fromEntries(
      (await entitlements()).map((e) => [e.orderId, e]),
    );
    expect(byOrder[partial]!.revokedAt).toBeNull();
    expect(byOrder[full]!.revokedAt).not.toBeNull();
  });

  test("下载页与下载接口：只给更新期内发布的版本，别人的授权不算", async () => {
    await handle(buy(`ord_${randomUUID()}`));
    const [inWindow, afterWindow] = await db
      .insert(downloadReleases)
      .values([
        {
          productId,
          version: "1.0.0",
          objectKey: `downloads/${productId}/1.0.0/a.zip`,
          size: 10,
          publishedAt: new Date("2027-01-01T00:00:00Z"),
        },
        {
          productId,
          version: "2.0.0",
          objectKey: `downloads/${productId}/2.0.0/a.zip`,
          size: 10,
          publishedAt: new Date("2027-10-01T00:00:00Z"),
        },
      ])
      .returning();

    const [entry] = await listDownloads(db, userId);
    expect(entry!.releases.map((r) => r.version)).toEqual(["1.0.0"]);
    expect((await findDownload(db, userId, inWindow!.id))?.version).toBe(
      "1.0.0",
    );
    expect(await findDownload(db, userId, afterWindow!.id)).toBeNull();
    expect(
      await findDownload(db, `u_${randomUUID()}`, inWindow!.id),
    ).toBeNull();
    expect(await findDownload(db, userId, randomUUID())).toBeNull();
  });
});
