// @vitest-environment node
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import { notificationLog, user } from "@/core/db/schema";

import {
  claimNotification,
  releaseNotificationClaim,
} from "./notification-log";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url)
  console.warn(
    "Skipping notification claim tests: DATABASE_URL_TEST is not set",
  );

const HOUR = 3600 * 1000;
const KIND = "test-notice";

describe.skipIf(!url)("notification claim and release (real Postgres)", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let key: string;

  const claim = (now: Date, windowMs: number | null = null) =>
    claimNotification(db, { kind: KIND, key, userId, windowMs, now });
  const release = (now: Date) =>
    releaseNotificationClaim(db, { kind: KIND, key, now });
  const rows = () =>
    db.select().from(notificationLog).where(eq(notificationLog.userId, userId));

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });
  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    userId = `u_${randomUUID()}`;
    key = `key_${randomUUID()}`;
    await db.insert(user).values({
      id: userId,
      name: "Ada",
      email: `notice-${randomUUID().slice(0, 8)}@example.com`,
    });
  });

  test("after a failed send releases the claim, the same (kind, key) can be claimed and resent", async () => {
    const at = new Date("2026-09-25T00:00:00.000Z");

    expect(await claim(at)).toBe(true);
    // The slot is taken: claiming the same key again fails (this is what prevents duplicate spam).
    expect(await claim(at)).toBe(false);

    // Send fails → release the claim.
    expect(await release(at)).toBe(true);
    expect(await rows()).toHaveLength(0);

    // Retry: the claim succeeds again and the email can actually go out.
    expect(await claim(at)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  test("release only deletes this attempt's row: a claim taken over by a newer send is left alone", async () => {
    const first = new Date("2026-09-25T00:00:00.000Z");
    const second = new Date(first.getTime() + 2 * HOUR); // past the window, can send again

    expect(await claim(first, HOUR)).toBe(true);
    expect(await claim(second, HOUR)).toBe(true);

    // The first attempt fails only after the second one claimed the slot: the second claim must
    // not be deleted, or we'd send duplicates.
    expect(await release(first)).toBe(false);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.lastSentAt).toEqual(second);

    // The second claim still holds: no more sends within the window.
    expect(await claim(new Date(second.getTime() + 10 * 60 * 1000), HOUR)).toBe(
      false,
    );
  });

  test("release returns false when never claimed or already released", async () => {
    const at = new Date("2026-09-25T00:00:00.000Z");

    expect(await release(at)).toBe(false);

    expect(await claim(at)).toBe(true);
    expect(await release(at)).toBe(true);
    expect(await release(at)).toBe(false);
  });
});
