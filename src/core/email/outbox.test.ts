// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq } from "drizzle-orm";
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
  vi,
} from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import {
  billingExceptions,
  notificationLog,
  pendingNotifications,
  user,
} from "@/core/db/schema";

import { claimNotification } from "./notification-log";
import {
  createOutbox,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SENDING_STALE_MS,
  type OutboxSend,
} from "./outbox";

// Real-database tests for the outbox: "sent" means send was called (the equivalent of the
// provider's record of received emails).

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping outbox tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

const SECRET = "outbox-test-secret-that-is-long-enough-0123456789";
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)("transactional email outbox", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let delivered: {
    to: string;
    template: string;
    props: unknown;
    key?: string;
  }[];
  let down: boolean;
  let clock: { now: number };

  /**
   * Fake provider: throws while `down`; records every email it receives (with its idempotency key).
   */
  const send: OutboxSend = async (options, sendOptions) => {
    if (down) throw new Error("resend 503");
    delivered.push({
      to: String(options.to),
      template: options.template,
      props: options.props,
      key: sendOptions.idempotencyKey,
    });
  };

  /** One "instance". A process restart = building another one against the same database. */
  const instance = (sendImpl: OutboxSend = send) =>
    createOutbox({
      db,
      send: sendImpl,
      secret: SECRET,
      retry: { attempts: 1, delayMs: 0 },
      now: () => new Date(clock.now),
      logError: vi.fn(),
    });

  const rows = () =>
    db
      .select()
      .from(pendingNotifications)
      .where(eq(pendingNotifications.userId, userId));

  /**
   * A payment-succeeded email: like the billing hook, claim the dedupe slot first, then enqueue (in
   * the same transaction).
   */
  async function enqueuePayment(
    outbox = instance(),
    key = `order:${randomUUID()}`,
  ) {
    const claimedAt = new Date(clock.now);
    return db.transaction(async (tx) => {
      const claimed = await claimNotification(tx, {
        kind: "payment-succeeded",
        key,
        userId,
        windowMs: null,
        now: claimedAt,
      });
      if (!claimed) return null;
      return outbox.enqueue(tx, {
        kind: "payment-succeeded",
        key,
        userId,
        to: `${userId}@example.com`,
        template: "payment-succeeded",
        props: {
          planName: "Pro",
          kind: "one_time",
          paidAt: "2026-09-29T00:00:00Z",
          manageUrl: "https://x.test/billing",
        },
        locale: "en",
        claimedAt,
      });
    });
  }

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
    await client?.close();
  });

  beforeEach(async () => {
    delivered = [];
    down = false;
    clock = { now: Date.now() };
    userId = `outbox-test-${randomUUID()}`;
    await db
      .insert(user)
      .values({ id: userId, name: "T", email: `${userId}@example.com` });
  });

  test("sends right after enqueue: one email, with idempotency key notification/<row id>", async () => {
    const outbox = instance();
    const id = await enqueuePayment(outbox);
    expect(await outbox.deliver(id!)).toBe("sent");
    expect(delivered).toEqual([
      expect.objectContaining({
        template: "payment-succeeded",
        key: `notification/${id}`,
      }),
    ]);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
    // Delivering an already-sent row again: the claim fails, nothing is resent.
    expect(await outbox.deliver(id!)).toBe("skipped");
    expect(delivered).toHaveLength(1);
  });

  test("provider down: the row stays in the database; once it recovers the sweep sends it", async () => {
    const outbox = instance();
    down = true;
    const id = await enqueuePayment(outbox);
    expect(await outbox.deliver(id!)).toBe("retry");
    const [pending] = await rows();
    expect(pending).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "resend 503",
    });
    expect(pending!.nextRetryAt.getTime()).toBeGreaterThan(clock.now);

    // Not yet due for retry: the sweep leaves it alone.
    down = false;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({ due: 0 });
    expect(delivered).toHaveLength(0);

    clock.now += 2 * 60_000;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      due: 1,
      sent: 1,
    });
    expect(delivered).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("app restart: the old instance enqueues, fails to send, and disappears; the new instance's sweep resends", async () => {
    down = true;
    const before = instance();
    const id = await enqueuePayment(before);
    await before.deliver(id!);

    down = false;
    clock.now += HOUR;
    const after = instance();
    await after.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.key).toBe(`notification/${id}`);
  });

  test("process dies mid-send (stuck in sending): after the timeout it goes back to the queue and resends with the same idempotency key", async () => {
    const outbox = instance();
    const id = await enqueuePayment(outbox);
    // Simulate: the row was claimed (sending), and the process died before recording the result.
    await db
      .update(pendingNotifications)
      .set({ status: "sending", updatedAt: new Date(clock.now) })
      .where(eq(pendingNotifications.id, id!));
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      reset: 0,
      due: 0,
    });

    clock.now += OUTBOX_SENDING_STALE_MS + 1000;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
      reset: 1,
      sent: 1,
    });
    // If the provider already received this email, the same key is recognized — the key must be
    // stable.
    expect(delivered[0]!.key).toBe(`notification/${id}`);
  });

  test("repeated sweeps, concurrent sweeps, and a racing immediate send: the email goes out only once", async () => {
    const outbox = instance();
    down = true;
    const id = await enqueuePayment(outbox);
    await outbox.deliver(id!);
    down = false;
    clock.now += 2 * 60_000;

    const others = [instance(), instance(), instance()];
    await Promise.all([
      outbox.deliver(id!),
      ...others.map((o) => o.scan({ userIds: [userId] })),
    ]);
    await outbox.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
  });

  test("event replay: while the (kind, key) claim is held, a second row can't be enqueued", async () => {
    const outbox = instance();
    const key = `order:${randomUUID()}`;
    down = true;
    const first = await enqueuePayment(outbox, key);
    await outbox.deliver(first!);
    expect(await enqueuePayment(outbox, key)).toBeNull();
    down = false;
    clock.now += 2 * 60_000;
    await outbox.scan({ userIds: [userId] });
    expect(delivered).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  test("retries exhausted: ends as failed and is kept, releases the dedupe claim, opens a resendable exception; manual resend succeeds", async () => {
    const outbox = instance();
    down = true;
    const key = `order:${randomUUID()}`;
    const id = await enqueuePayment(outbox, key);
    await outbox.deliver(id!);
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      clock.now += 5 * HOUR;
      await outbox.scan({ userIds: [userId] });
    }
    const [failed] = await rows();
    expect(failed).toMatchObject({
      status: "failed",
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "resend 503",
    });
    // Further sweeps don't retry forever.
    clock.now += 5 * HOUR;
    expect(await outbox.scan({ userIds: [userId] })).toMatchObject({ due: 0 });

    // Claim released: the same event can send again if it fires later.
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.kind, "payment-succeeded"),
            eq(notificationLog.key, key),
          ),
        ),
    ).toHaveLength(0);

    // Exception: visible in the admin, pointing at this row.
    const [exception] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.userId, userId));
    expect(exception).toMatchObject({
      kind: "notification_failed",
      source: "pending_notifications",
      sourceId: id,
      status: "open",
      lastError: "resend 503",
    });

    // Manual resend: once the provider is back, requeue and send once right away.
    down = false;
    expect(await outbox.resend(id!)).toBe("sent");
    expect(delivered).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
    // An already-sent email can't be resent.
    expect(await outbox.resend(id!)).toBe("skipped");
  });

  describe("verification codes (sensitive props)", () => {
    async function enqueueCode(outbox = instance(), code = "123456") {
      return outbox.enqueue(db, {
        kind: "sign-in-code",
        key: `sign-in:${userId}@example.com`,
        userId,
        to: `${userId}@example.com`,
        template: "sign-in-code",
        props: { code, expiresInMinutes: 5 },
        locale: "en",
        sensitive: true,
        expiresAt: new Date(clock.now + 5 * 60_000),
        supersede: true,
      });
    }

    test("the database holds only ciphertext; the original is cleared after sending; the email has the original code", async () => {
      const outbox = instance();
      const id = await enqueueCode(outbox, "482913");
      const [stored] = await rows();
      expect(JSON.stringify(stored!.props)).not.toContain("482913");
      expect(stored!.props).toEqual({ enc: expect.any(String) });

      expect(await outbox.deliver(id)).toBe("sent");
      expect(delivered[0]!.props).toEqual({
        code: "482913",
        expiresInMinutes: 5,
      });
      expect((await rows())[0]!.props).toEqual({});
    });

    test("unsent past its validity: the sweep discards it and clears the original, without sending or opening an exception", async () => {
      const outbox = instance();
      down = true;
      const id = await enqueueCode(outbox);
      // A retry after 1 minute is still within the 5-minute validity: keep it for a resend.
      expect(await outbox.deliver(id)).toBe("retry");

      down = false;
      clock.now += 6 * 60_000;
      expect(await outbox.scan({ userIds: [userId] })).toMatchObject({
        expired: 1,
        due: 0,
      });
      expect(delivered).toHaveLength(0);
      const [row] = await rows();
      expect(row).toMatchObject({ status: "failed", props: {} });
      expect(row!.lastError).toContain("expired");
      expect(
        await db
          .select()
          .from(billingExceptions)
          .where(eq(billingExceptions.userId, userId)),
      ).toHaveLength(0);
    });

    test("requesting a new code: the new code supersedes the unsent old one, and only the new code is sent after recovery", async () => {
      const outbox = instance();
      down = true;
      const old = await enqueueCode(outbox, "111111");
      await outbox.deliver(old);
      const fresh = await enqueueCode(outbox, "222222");
      await outbox.deliver(fresh);

      const byId = new Map((await rows()).map((r) => [r.id, r]));
      expect(byId.get(old)).toMatchObject({
        status: "failed",
        lastError: "superseded",
        props: {},
      });

      down = false;
      clock.now += 2 * 60_000;
      await outbox.scan({ userIds: [userId] });
      expect(delivered.map((d) => (d.props as { code: string }).code)).toEqual([
        "222222",
      ]);
    });
  });
});
