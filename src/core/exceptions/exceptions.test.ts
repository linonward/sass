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

import type { VideoTaskStatus } from "@/core/ai/alibaba-video";
import { createVideoService, VIDEO_TIMEOUT_MS } from "@/core/ai/video";
import type { BillingEvent } from "@/core/billing/events";
import { createGrantCreditsHandler } from "@/core/billing/grant-credits";
import { handleBillingEvent } from "@/core/billing/handle-event";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "@/core/billing/on-billing-event";
import {
  createReclaimCreditsHandler,
  REFUND_RECLAIM_SOURCE,
} from "@/core/billing/reclaim-credits";
import { FakeProvider } from "@/core/billing/testing/fake-provider";
import { aiConfigSchema } from "@/core/config/schema";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  adminActions,
  aiUsage,
  billingExceptions,
  creditTransactions,
  orders,
  user,
} from "@/core/db/schema";
import { MemoryStorage } from "@/core/upload/testing";

import { listExceptions } from "./queries";
import { createExceptionService, EXCEPTION_TARGET } from "./service";

// Real-database tests for the billing exceptions page. Settlement changes are checked against three
// pieces of state: the order (orders), credit transactions (credit_transactions, including the
// balance), and the exception (billing_exceptions); on the AI side it is ai_usage.

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping exceptions page tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

// The lifetime plan in site.config.ts grants 2000 credits at once.
const GRANTED = 2000;
const ORDER_AMOUNT = 3000;

describe.skipIf(!url)("billing exceptions page", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let credits: Credits;
  let fake: FakeProvider;
  let userId: string;
  let adminId: string;

  const handle = (event: BillingEvent) => handleBillingEvent(event, { db });

  function useCredits(
    reclaimCredits: Credits["reclaimCredits"] = credits.reclaimCredits,
  ) {
    resetOnBillingEvent();
    registerOnBillingEvent(
      "billing:grant-credits",
      createGrantCreditsHandler({
        enabled: true,
        grantCredits: credits.grantCredits,
      }),
    );
    registerOnBillingEvent(
      "billing:reclaim-credits",
      createReclaimCreditsHandler({ enabled: true, reclaimCredits }),
    );
  }

  /** A service whose video service answers with the status the test provides. */
  function service(
    provider = { next: { status: "pending" } as VideoTaskStatus },
  ) {
    const video = {
      recoverVideo: vi.fn(async () => ({ status: "pending" })),
      providerStatus: vi.fn(async () => provider.next),
    };
    return {
      ...createExceptionService({
        db: () => db,
        credits,
        video,
        outbox: { resend: vi.fn(async () => "sent" as const) },
      }),
      video,
      provider,
    };
  }

  async function newUser(prefix: string) {
    const id = `${prefix}-${randomUUID()}`;
    await db.insert(user).values({ id, name: "T", email: `${id}@example.com` });
    return id;
  }

  async function purchase(orderId = `ord_${randomUUID()}`) {
    const event = fake.event("checkout.completed", {
      userId,
      checkoutId: `chk_${randomUUID()}`,
      orderId,
      planId: "lifetime",
      amount: ORDER_AMOUNT,
      currency: "USD",
    });
    expect(await handle(event)).toMatchObject({ status: "processed" });
    return orderId;
  }

  const refund = (
    orderId: string,
    {
      amount = ORDER_AMOUNT,
      refundId = `ref_${randomUUID()}`,
      eventId,
    }: { amount?: number; refundId?: string; eventId?: string } = {},
  ) =>
    fake.event("refund.created", {
      userId,
      orderId,
      refundId,
      amount,
      currency: "USD",
      ...(eventId ? { eventId } : {}),
    });

  /** Spends credits so a later refund reclaim falls short. */
  const spend = (amount: number) =>
    credits.deductCredits({
      userId,
      amount,
      source: "ai",
      sourceId: `call_${randomUUID()}`,
    });

  /** The three pieces of state: order, reclaim transactions and balance, exception. */
  async function state(orderId: string) {
    const [order] = await db
      .select({
        refundedAmount: orders.refundedAmount,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.providerOrderId, orderId));
    const reclaims = await db
      .select({
        amount: creditTransactions.amount,
        sourceId: creditTransactions.sourceId,
      })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.source, REFUND_RECLAIM_SOURCE),
        ),
      );
    const exceptions = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.userId, userId));
    return {
      order: order!,
      reclaims,
      reclaimed: reclaims.reduce((sum, tx) => sum - tx.amount, 0),
      balance: await credits.getBalance(userId),
      exceptions,
    };
  }

  const history = (exceptionId: string) =>
    db
      .select()
      .from(adminActions)
      .where(
        and(
          eq(adminActions.targetKind, EXCEPTION_TARGET),
          eq(adminActions.targetId, exceptionId),
        ),
      );

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    db = client.db;
    credits = createCredits({ db, enabled: true });
    adminId = await newUser("exceptions-admin");
  });

  afterAll(async () => {
    resetOnBillingEvent();
    await client?.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = await newUser("exceptions-test");
    useCredits();
  });

  test("a short balance makes the reclaim open a shortfall exception in the same transaction; the admin list shows the shortfall", async () => {
    const orderId = await purchase();
    await spend(1500);

    await handle(refund(orderId));

    const s = await state(orderId);
    expect(s.order.refundedAmount).toBe(ORDER_AMOUNT);
    expect(s.reclaimed).toBe(500);
    expect(s.balance).toBe(0);
    expect(s.exceptions).toHaveLength(1);
    expect(s.exceptions[0]).toMatchObject({
      kind: "refund_reclaim_shortfall",
      status: "open",
      source: REFUND_RECLAIM_SOURCE,
      detail: expect.objectContaining({
        orderId,
        granted: GRANTED,
        owed: GRANTED,
        reclaimed: 500,
        shortfall: 1500,
      }),
    });

    const listed = await listExceptions(db, {
      kind: "refund_reclaim_shortfall",
      status: "open",
    });
    expect(listed.rows.find((row) => row.userId === userId)).toMatchObject({
      detail: expect.objectContaining({ shortfall: 1500 }),
      email: `${userId}@example.com`,
    });
  });

  test("scenario 4: the reclaim transaction hits a transient database failure — after replay it reclaims once, refunds once, and opens one exception", async () => {
    const orderId = await purchase();
    await spend(1500);
    const event = refund(orderId);

    // On the first attempt the reclaim step throws: the whole webhook transaction rolls back and
    // leaves nothing behind.
    useCredits(async () => {
      throw new Error("connection reset");
    });
    await expect(handle(event)).rejects.toThrow(/billing:reclaim-credits/);
    let s = await state(orderId);
    expect(s.order.refundedAmount).toBe(0);
    expect(s.reclaims).toHaveLength(0);
    expect(s.exceptions).toHaveLength(0);

    // The provider redelivers (same event): this time it succeeds.
    useCredits();
    expect(await handle(event)).toMatchObject({ status: "processed" });
    // Deliver the same event once more: webhook_events blocks it, and all three states are unchanged.
    expect(await handle(event)).toEqual({ status: "duplicate" });
    s = await state(orderId);
    expect(s.order.refundedAmount).toBe(ORDER_AMOUNT);
    expect(s.reclaims).toHaveLength(1);
    expect(s.reclaimed).toBe(500);
    expect(s.exceptions).toHaveLength(1);

    // The same refund redelivered with a new event ID: the reclaim transaction and the exception
    // are each blocked by their own unique key. (The order's refundedAmount gets added twice here —
    // that's an existing issue with order merging deduping by event rather than by refundId, outside
    // the exceptions page's scope; the reclaim is capped at the order amount, so credits are not
    // affected.)
    await handle({ ...event, eventId: `evt_${randomUUID()}` });
    s = await state(orderId);
    expect(s.reclaims).toHaveLength(1);
    expect(s.reclaimed).toBe(500);
    expect(s.exceptions).toHaveLength(1);
  });

  test("scenario 1: the same refund delivered repeatedly and redelivered with a new event ID — no second exception", async () => {
    const orderId = await purchase();
    await spend(GRANTED);
    const refundId = `ref_${randomUUID()}`;
    const event = refund(orderId, { refundId });

    await Promise.all([handle(event), handle(event)]);
    await handle(refund(orderId, { refundId, eventId: `evt_${randomUUID()}` }));

    const s = await state(orderId);
    // Balance is 0: nothing can be deducted and there is no reclaim transaction, but there is
    // exactly one shortfall exception.
    expect(s.reclaims).toHaveLength(0);
    expect(s.exceptions).toHaveLength(1);
    expect(s.exceptions[0]!.detail).toMatchObject({ shortfall: GRANTED });
  });

  test("retry reclaim: once the balance is enough, deducts the shortfall, closes the exception, and writes the audit", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;

    // The user bought more credits (granted directly here), so the balance now covers the shortfall.
    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });
    const s = service();
    const outcome = await s.retryReclaim({
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "user topped up",
    });
    expect(outcome).toEqual({
      ok: true,
      result: "reclaimed:1500",
      closed: true,
    });

    const after = await state(orderId);
    expect(after.reclaimed).toBe(GRANTED);
    expect(after.balance).toBe(5000 - 1500);
    expect(after.exceptions[0]).toMatchObject({
      status: "resolved",
      resolution: "user topped up",
      attempts: 1,
    });
    expect(after.exceptions[0]!.resolvedAt).not.toBeNull();
    expect(await history(exception!.id)).toEqual([
      expect.objectContaining({
        actorId: adminId,
        action: "retry_reclaim",
        reason: "user topped up",
        result: "reclaimed:1500",
      }),
    ]);

    // Clicking again after closing does nothing.
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "again",
      }),
    ).toEqual({ ok: false, error: "not_open" });
    expect((await state(orderId)).reclaimed).toBe(GRANTED);
  });

  test('clicking "retry reclaim" repeatedly deducts only once (transaction count and balance)', async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });

    const s = service();
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        s.retryReclaim({
          actorId: adminId,
          exceptionId: exception!.id,
          reason: "double click",
        }),
      ),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([
      { ok: false, error: "not_open" },
      { ok: false, error: "not_open" },
    ]);

    const after = await state(orderId);
    // 1 original reclaim + 1 retry.
    expect(after.reclaims).toHaveLength(2);
    expect(after.reclaimed).toBe(GRANTED);
    expect(after.balance).toBe(5000 - 1500);
    expect(await history(exception!.id)).toHaveLength(1);
  });

  test("retry with the balance still short: deducts what it can, keeps the exception open, and accumulates attempts and errors", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    await credits.grantCredits({
      userId,
      amount: 400,
      source: "test",
      sourceId: randomUUID(),
    });

    const s = service();
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "try",
      }),
    ).toEqual({ ok: true, result: "partial:400/1500", closed: false });
    let after = await state(orderId);
    expect(after.reclaimed).toBe(900);
    expect(after.exceptions[0]).toMatchObject({
      status: "open",
      attempts: 1,
      lastError: "balance insufficient: owed 1500, reclaimed 400, balance 0",
      detail: expect.objectContaining({ shortfall: 1100 }),
    });

    // Retry with a balance of 0: nothing can be deducted, so no transaction is written.
    expect(
      await s.retryReclaim({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "try again",
      }),
    ).toEqual({ ok: true, result: "uncollectible:1100", closed: false });
    after = await state(orderId);
    expect(after.reclaims).toHaveLength(2);
    expect(after.exceptions[0]!.attempts).toBe(2);
    expect(await history(exception!.id)).toHaveLength(2);
  });

  test("nothing owed anymore (a later refund reclaim made it up): retry just closes the exception without deducting", async () => {
    const orderId = await purchase();
    await spend(1500);
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 2 }));
    const [exception] = (await state(orderId)).exceptions;
    expect(exception!.detail).toMatchObject({ owed: 1000, shortfall: 500 });

    await credits.grantCredits({
      userId,
      amount: 5000,
      source: "test",
      sourceId: randomUUID(),
    });
    // A second refund arrives: since the amount owed is cumulative, this one also collects the
    // previous shortfall.
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 2 }));
    expect((await state(orderId)).reclaimed).toBe(GRANTED);

    const outcome = await service().retryReclaim({
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "covered by later refund",
    });
    expect(outcome).toEqual({ ok: true, result: "nothing_owed", closed: true });
    expect((await state(orderId)).reclaimed).toBe(GRANTED);
  });

  test("mark resolved / ignore: requires a reason (checked by the Server Action), writes the audit, and a closed exception cannot be handled again", async () => {
    const orderId = await purchase();
    await spend(GRANTED);
    await handle(refund(orderId));
    const [exception] = (await state(orderId)).exceptions;
    const s = service();

    expect(
      await s.resolve({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "written off",
        status: "ignored",
      }),
    ).toEqual({ ok: true, result: "ignored", closed: true });
    expect(
      await s.resolve({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "twice",
        status: "resolved",
      }),
    ).toEqual({ ok: false, error: "not_open" });
    expect((await state(orderId)).exceptions[0]).toMatchObject({
      status: "ignored",
      resolution: "written off",
    });
    expect(await history(exception!.id)).toEqual([
      expect.objectContaining({ action: "ignore", reason: "written off" }),
    ]);
    // An action for the wrong kind is rejected.
    expect(
      await s.recheck({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "x",
      }),
    ).toEqual({ ok: false, error: "wrong_kind" });
  });

  test("undelivered email exception: a failed resend keeps it open and counts the attempt; only a successful resend closes it; both write the audit", async () => {
    const notificationId = randomUUID();
    const [exception] = await db
      .insert(billingExceptions)
      .values({
        kind: "notification_failed",
        userId,
        source: "pending_notifications",
        sourceId: notificationId,
        detail: { template: "payment-succeeded", to: "a@example.com" },
        attempts: 1,
        lastError: "resend 503",
      })
      .returning();
    const resend = vi
      .fn()
      .mockResolvedValueOnce("retry")
      .mockResolvedValueOnce("sent");
    const s = createExceptionService({
      db: () => db,
      credits,
      video: { recoverVideo: vi.fn(), providerStatus: vi.fn() },
      outbox: { resend },
    });
    const input = {
      actorId: adminId,
      exceptionId: exception!.id,
      reason: "provider back up",
    };

    expect(await s.resendNotification(input)).toEqual({
      ok: true,
      result: "retry",
      closed: false,
    });
    let [row] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, exception!.id));
    expect(row).toMatchObject({
      status: "open",
      attempts: 2,
      lastError: "resend: retry",
    });

    expect(await s.resendNotification(input)).toEqual({
      ok: true,
      result: "sent",
      closed: true,
    });
    [row] = await db
      .select()
      .from(billingExceptions)
      .where(eq(billingExceptions.id, exception!.id));
    expect(row).toMatchObject({
      status: "resolved",
      resolution: "provider back up",
    });
    expect(resend).toHaveBeenCalledWith(notificationId);
    expect((await history(exception!.id)).map((h) => h.result)).toEqual([
      "retry",
      "sent",
    ]);
    expect(await s.resendNotification(input)).toEqual({
      ok: false,
      error: "not_open",
    });
  });

  describe("AI tasks", () => {
    const config = aiConfigSchema.parse({
      videoModels: [
        {
          id: "t2v",
          provider: "alibaba",
          model: "wan2.7-t2v",
          input: "text",
          creditCost: 20,
        },
      ],
      defaultVideoModel: "t2v",
    });

    function videoSetup() {
      const provider = { next: { status: "pending" } as VideoTaskStatus };
      const clock = { now: Date.now() };
      const client = {
        start: vi.fn(async () => ({ taskId: `task-${randomUUID()}` })),
        status: vi.fn(async () => provider.next),
      };
      const video = createVideoService({
        db,
        config,
        credits,
        checkRateLimit: async () => ({ ok: true, retryAfter: 0 }),
        getClient: () => client,
        getStorage: () => new MemoryStorage(),
        fileUrl: async (key) => key,
        now: () => clock.now,
        logError: vi.fn(),
      });
      return { video, provider, clock, client };
    }

    async function startVideo(v: ReturnType<typeof videoSetup>) {
      await credits.grantCredits({
        userId,
        amount: 100,
        source: "test",
        sourceId: randomUUID(),
      });
      const started = await v.video.startVideo({ userId, prompt: "waves" });
      if (!started.ok) throw new Error(`unexpected ${started.status}`);
      return started.job.id;
    }

    const aiExceptions = () =>
      db
        .select()
        .from(billingExceptions)
        .where(
          and(
            eq(billingExceptions.userId, userId),
            eq(billingExceptions.kind, "ai_job_needs_review"),
          ),
        );

    test('a refund for "provider has no result" opens an exception in the same transaction as the refund; concurrent settlement opens only one', async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await Promise.all([
        v.video.pollVideo({ userId, id }),
        v.video.pollVideo({ userId, id }),
        v.video.recoverVideo(id),
      ]);
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, id));
      expect(usage!.status).toBe("failed");
      expect(await credits.getBalance(userId)).toBe(100);
      const rows = await aiExceptions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: "ai_usage",
        sourceId: id,
        status: "open",
        detail: expect.objectContaining({
          usageId: id,
          refunded: true,
          reason: "timeout: provider returned no result within 30 minutes",
        }),
      });
    });

    test("a refund for an explicit provider failure opens no exception", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.provider.next = { status: "failed", error: "FAILED" };
      await v.video.pollVideo({ userId, id });
      expect(await aiExceptions()).toHaveLength(0);
    });

    test("provider status still unavailable past the result deadline: opens an exception and counts attempts, task untouched", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.client.status.mockRejectedValue(new Error("dashscope 500"));
      // Unavailable within 30 minutes: a transient error, no exception.
      await v.video.recoverVideo(id);
      expect(await aiExceptions()).toHaveLength(0);

      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.recoverVideo(id);
      await v.video.recoverVideo(id);
      const rows = await aiExceptions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        attempts: 2,
        lastError: "dashscope 500",
        detail: expect.objectContaining({
          reason: "provider task status unavailable",
        }),
      });
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, id));
      expect(usage!.status).toBe("pending");
    });

    test("reconcile again: when the task was refunded, only records the provider's current status, touches no money, and leaves the exception for a human", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.pollVideo({ userId, id });
      const [exception] = await aiExceptions();

      const s = service({
        next: { status: "succeeded", videoUrl: "https://x.test/v.mp4" },
      });
      const outcome = await s.recheck({
        actorId: adminId,
        exceptionId: exception!.id,
        reason: "user says it finished",
      });
      expect(outcome).toEqual({
        ok: true,
        result: "provider:succeeded",
        closed: false,
      });
      expect(s.video.recoverVideo).not.toHaveBeenCalled();
      const [after] = await aiExceptions();
      expect(after).toMatchObject({
        status: "open",
        attempts: 1,
        lastError: null,
        detail: expect.objectContaining({ providerStatus: "succeeded" }),
      });
      expect(await credits.getBalance(userId)).toBe(100);
      expect(await history(exception!.id)).toEqual([
        expect.objectContaining({
          action: "recheck",
          reason: "user says it finished",
          result: "provider:succeeded",
        }),
      ]);
    });

    test("reconcile again: when the task is still pending, uses the recovery path and closes the exception once it reaches a terminal state", async () => {
      const v = videoSetup();
      const id = await startVideo(v);
      v.client.status.mockRejectedValue(new Error("dashscope 500"));
      v.clock.now += VIDEO_TIMEOUT_MS + 1000;
      await v.video.recoverVideo(id);
      const [exception] = await aiExceptions();

      const s = service();
      s.video.recoverVideo.mockResolvedValueOnce({ status: "succeeded" });
      expect(
        await s.recheck({
          actorId: adminId,
          exceptionId: exception!.id,
          reason: "provider is back",
        }),
      ).toEqual({ ok: true, result: "recovered:succeeded", closed: true });
      expect(s.video.recoverVideo).toHaveBeenCalledWith(id);
      const [after] = await aiExceptions();
      expect(after).toMatchObject({
        status: "resolved",
        resolution: "provider is back",
      });
    });
  });
});
