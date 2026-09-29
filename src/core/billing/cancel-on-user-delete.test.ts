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

test("the cancel-subscription hook for account deletion is registered", async () => {
  await import("@/core/account/hooks");
  expect(onUserDeleteHandlers()).toContain("billing:cancel-subscriptions");
});

describe.skipIf(!url)("onUserDelete: cancels billable subscriptions", () => {
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

  test("only cancels active and past_due subscriptions", async () => {
    const active = await addSubscription("active");
    const pastDue = await addSubscription("past_due");
    await addSubscription("canceled");
    await addSubscription("expired");

    await run(fake);
    expect(fake.canceled.sort()).toEqual([active, pastDue].sort());
  });

  test("passes without a configured provider when there is nothing to cancel", async () => {
    await addSubscription("expired");
    await expect(run(null)).resolves.toBeUndefined();
  });

  test("throws when there are subscriptions to cancel but no provider is configured, aborting deletion", async () => {
    await addSubscription("active");
    await expect(run(null)).rejects.toThrow(/provider not configured/);
  });

  test("throws when the provider fails to cancel", async () => {
    await addSubscription("active");
    const failing = new FakeProvider("secret", fake.id);
    failing.cancelSubscription = async () => {
      throw new Error("creem down");
    };
    await expect(run(failing)).rejects.toThrow("creem down");
  });

  test("the hook can run repeatedly (idempotency for already-canceled subscriptions is guaranteed by the Creem implementation, see creem.test.ts)", async () => {
    await addSubscription("active");
    await run(fake);
    await run(fake);
    expect(fake.canceled).toHaveLength(2);
  });
});
