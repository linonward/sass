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
import { notificationLog, pendingNotifications, user } from "@/core/db/schema";
import { createOutbox } from "@/core/email/outbox";
import { claimNotification } from "@/core/email/notification-log";
import { sendEmail, type SendEmailOptions } from "@/core/email/send";
import { readLatestEmail } from "@/core/email/testing";

import siteConfig from "../../../site.config";
import { CreditsDisabledError } from "./errors";
import { createLowBalanceHook } from "./low-balance";
import { createCredits, type AfterCommitCallback } from "./service";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url)
  console.warn("Skipping credits-low tests: DATABASE_URL_TEST is not set");

const HOUR = 3600 * 1000;
const THRESHOLD = 100;

describe.skipIf(!url)("credits-low reminder (real Postgres)", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  let email: string;
  let clock: Date;
  let failSend: boolean;
  const sent: SendEmailOptions<"credits-low">[] = [];
  let seq = 0;

  const capture = async (message: SendEmailOptions<"credits-low">) => {
    if (failSend) throw new Error("SMTP down");
    sent.push(message);
  };

  const credits = (
    options: { enabled?: boolean; send?: typeof capture } = {},
  ) =>
    createCredits({
      db,
      enabled: options.enabled ?? true,
      lowBalance: createLowBalanceHook({
        threshold: THRESHOLD,
        send: options.send ?? capture,
        db,
        // These cases don't care about the quick retries of the immediate send; one failure is
        // left to the resend sweep.
        retry: { attempts: 1, delayMs: 0 },
        now: () => clock,
      }),
    });

  /** This user's dedupe slots (each case uses a new user, so they don't leak across cases). */
  const claims = () =>
    db.select().from(notificationLog).where(eq(notificationLog.userId, userId));
  const outboxRows = () =>
    db
      .select()
      .from(pendingNotifications)
      .where(eq(pendingNotifications.userId, userId));

  const grant = (amount: number) =>
    credits().grantCredits({
      userId,
      amount,
      source: "test",
      sourceId: `g_${++seq}_${randomUUID()}`,
    });
  const deduct = (amount: number, c = credits()) =>
    c.deductCredits({
      userId,
      amount,
      source: "test",
      sourceId: `d_${++seq}_${randomUUID()}`,
    });

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });
  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    failSend = false;
    clock = new Date("2026-09-25T00:00:00.000Z");
    userId = `u_${randomUUID()}`;
    email = `low-${randomUUID().slice(0, 8)}@example.com`;
    await db
      .insert(user)
      .values({ id: userId, name: "Ada", email, emailVerified: true });
  });

  test("sends one when crossing the threshold; further deductions below it send no more", async () => {
    await grant(150);
    await deduct(30); // 150 → 120
    expect(sent).toHaveLength(0);
    await deduct(30); // 120 → 90, crosses 100
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: email,
      template: "credits-low",
      locale: "en",
      props: {
        balance: 90,
        threshold: THRESHOLD,
        topUpUrl: `https://${siteConfig.domain}/pricing`,
      },
    });
    await deduct(10); // 90 → 80
    await deduct(80); // 80 → 0
    expect(sent).toHaveLength(1);
  });

  test("no reminder when landing exactly on the threshold, only when going below it", async () => {
    await grant(150);
    await deduct(50); // → 100
    expect(sent).toHaveLength(0);
    await deduct(1); // → 99
    expect(sent).toHaveLength(1);
  });

  test("crossing again within 24 hours sends nothing; after 24 hours it sends again", async () => {
    await grant(150);
    await deduct(60); // → 90, sends the first one
    expect(sent).toHaveLength(1);

    clock = new Date(clock.getTime() + 23 * HOUR);
    await grant(100); // → 190
    await deduct(100); // → 90, crosses again 23 hours later
    expect(sent).toHaveLength(1);

    clock = new Date(clock.getTime() + 2 * HOUR); // 25 hours after the first one
    await grant(100); // → 190
    await deduct(100); // → 90
    expect(sent).toHaveLength(2);
  });

  test("50 concurrent deductions send only one; balance and ledger agree", async () => {
    await grant(1040);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => deduct(20)),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await credits().getBalance(userId)).toBe(40);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.props.balance).toBeLessThan(THRESHOLD);
  });

  test("only one concurrent claim of the dedupe slot succeeds", async () => {
    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimNotification(db, {
          kind: "credits-low",
          key: userId,
          userId,
          windowMs: 24 * HOUR,
          now: clock,
        }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  test("with features.credits off, deduction throws and no email is sent", async () => {
    await expect(deduct(10, credits({ enabled: false }))).rejects.toThrow(
      CreditsDisabledError,
    );
    expect(sent).toHaveLength(0);
  });

  test("a failed email send does not affect the deduction", async () => {
    await grant(150);
    failSend = true;
    const result = await deduct(60);
    expect(result).toMatchObject({ status: "applied", balance: 90 });
  });

  test("immediate send fails: the reminder stays in the outbox and the slot is kept; the resend sweep sends one, and crossing again does not add another", async () => {
    await grant(150);
    failSend = true;
    await deduct(60); // 150 → 90, crosses; immediate send fails → waits in the outbox
    expect(sent).toHaveLength(0);
    expect(await claims()).toHaveLength(1);
    const [queued] = await outboxRows();
    expect(queued).toMatchObject({
      status: "pending",
      template: "credits-low",
    });

    // The slot is still held: crossing the threshold again an hour later doesn't queue another.
    clock = new Date(clock.getTime() + HOUR);
    await grant(100);
    await deduct(100);
    expect(await outboxRows()).toHaveLength(1);

    // The service recovers, and the resend sweep (as a fresh instance after a restart would) sends
    // it.
    failSend = false;
    await createOutbox({ db, send: capture as never, now: () => clock }).scan({
      userIds: [userId],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, template: "credits-low" });
    expect((await outboxRows())[0]).toMatchObject({ status: "sent" });
  });

  test("outer transaction: sent via the caller's afterCommit after commit; on rollback nothing is sent and the slot rolls back", async () => {
    await grant(150);
    const c = credits();

    // Roll back
    const rolledBack: AfterCommitCallback[] = [];
    await expect(
      db.transaction(async (tx) => {
        await c.deductCredits(
          {
            userId,
            amount: 60,
            source: "test",
            sourceId: `rb_${randomUUID()}`,
          },
          { tx, afterCommit: (fn) => rolledBack.push(fn) },
        );
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect(sent).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.userId, userId)),
    ).toHaveLength(0);

    // Commit: the caller runs the callbacks after commit
    const committed: AfterCommitCallback[] = [];
    await db.transaction(async (tx) => {
      await c.deductCredits(
        { userId, amount: 60, source: "test", sourceId: `ok_${randomUUID()}` },
        { tx, afterCommit: (fn) => committed.push(fn) },
      );
    });
    expect(sent).toHaveLength(0);
    for (const fn of committed) await fn();
    expect(sent).toHaveLength(1);
  });

  test("outer transaction without afterCommit: skips the reminder and does not claim a slot", async () => {
    await grant(150);
    await db.transaction(async (tx) => {
      await credits().deductCredits(
        { userId, amount: 60, source: "test", sourceId: `nt_${randomUUID()}` },
        { tx },
      );
    });
    expect(sent).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.userId, userId)),
    ).toHaveLength(0);
  });

  test("EMAIL_TRANSPORT=file: renders for real and writes to the file outbox", async () => {
    const previous = process.env.EMAIL_TRANSPORT;
    process.env.EMAIL_TRANSPORT = "file";
    try {
      await grant(150);
      const since = new Date();
      await deduct(60, credits({ send: sendEmail as never }));
      const stored = await readLatestEmail({
        to: email,
        template: "credits-low",
        since,
      });
      expect(stored?.subject).toContain("running low on credits");
      expect(stored?.text).toContain("90 credits");
    } finally {
      process.env.EMAIL_TRANSPORT = previous;
    }
  });
});
