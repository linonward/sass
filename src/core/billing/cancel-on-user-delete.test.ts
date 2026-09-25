// @vitest-environment node
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { onUserDeleteHandlers } from "@/core/account/on-user-delete";
import { createDbClient, type DbClient } from "@/core/db/client";
import { subscriptions, user, type SubscriptionStatus } from "@/core/db/schema";

import { createCancelSubscriptionsHandler } from "./cancel-on-user-delete";
import { FakeProvider } from "./testing/fake-provider";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

test("删除账户时的取消订阅钩子已注册", async () => {
  await import("@/core/account/hooks");
  expect(onUserDeleteHandlers()).toContain("billing:cancel-subscriptions");
});

describe.skipIf(!url)("onUserDelete：取消仍在计费的订阅", () => {
  let client: DbClient;
  let userId: string;
  let fake: FakeProvider;

  const handler = (provider: FakeProvider | null) =>
    createCancelSubscriptionsHandler({
      db: () => client.db,
      provider: () => provider,
    });

  async function addSubscription(status: SubscriptionStatus) {
    const id = `sub_${randomUUID().slice(0, 8)}`;
    await client.db.insert(subscriptions).values({
      userId,
      provider: fake.id,
      providerSubscriptionId: id,
      status,
      lastEventAt: new Date(),
    });
    return id;
  }

  const run = (provider: FakeProvider | null) =>
    handler(provider)({ userId, email: "x@example.com" });

  beforeAll(() => {
    client = createDbClient(url!);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = randomUUID();
    await client.db.insert(user).values({
      id: userId,
      name: "Delete Test",
      email: `delete-${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterEach(async () => {
    await client.db.delete(user).where(eq(user.id, userId));
  });

  test("只取消 active 和 past_due 的订阅", async () => {
    const active = await addSubscription("active");
    const pastDue = await addSubscription("past_due");
    await addSubscription("canceled");
    await addSubscription("expired");

    await run(fake);
    expect(fake.canceled.sort()).toEqual([active, pastDue].sort());
  });

  test("没有需要取消的订阅时，没配置服务商也能通过", async () => {
    await addSubscription("expired");
    await expect(run(null)).resolves.toBeUndefined();
  });

  test("有待取消的订阅但没配置服务商时抛错，删除随之中止", async () => {
    await addSubscription("active");
    await expect(run(null)).rejects.toThrow(/provider not configured/);
  });

  test("服务商取消失败时抛错", async () => {
    await addSubscription("active");
    const failing = new FakeProvider("secret", fake.id);
    failing.cancelSubscription = async () => {
      throw new Error("creem down");
    };
    await expect(run(failing)).rejects.toThrow("creem down");
  });

  test("钩子可以重复执行（已取消订阅的幂等由 Creem 实现保证，见 creem.test.ts）", async () => {
    await addSubscription("active");
    await run(fake);
    await run(fake);
    expect(fake.canceled).toHaveLength(2);
  });
});
