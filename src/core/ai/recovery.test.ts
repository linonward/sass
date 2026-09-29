// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { aiConfigSchema } from "@/core/config/schema";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import { aiUsage, creditTransactions, files, user } from "@/core/db/schema";
import type { RateLimitResult } from "@/core/ratelimit/limiter";
import { MemoryStorage } from "@/core/upload/testing";

import type { VideoClient, VideoTaskStatus } from "./alibaba-video";
import {
  createAiRecovery,
  RECOVERY_SYNC_HARD_LIMIT_MS,
  RECOVERY_VIDEO_STALE_MS,
} from "./recovery";
import { AI_CREDIT_SOURCE, reserveUsage } from "./usage";
import {
  createVideoService,
  VIDEO_RESULT_TTL_MS,
  VIDEO_TIMEOUT_MS,
} from "./video";

// Real-database tests for the recovery sweep: every scenario checks three places — ai_usage,
// credit_transactions, and the balance. AI calls create no orders; the order side is covered by the
// billing module's tests.

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping recovery sweep tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

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

const allowed: RateLimitResult = { ok: true, retryAfter: 0 };
const VIDEO_URL = "https://dashscope-result.test/v.mp4";
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
const MINUTE = 60 * 1000;

describe.skipIf(!url)("AI recovery sweep", () => {
  let dbClient: DbClient;
  let credits: Credits;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    dbClient = createDbClient(url!);
    credits = createCredits({ db: dbClient.db, enabled: true });
  });

  afterAll(async () => {
    await dbClient?.close();
  });

  async function newUser(balance: number) {
    const id = `recovery-test-${randomUUID()}`;
    await dbClient.db
      .insert(user)
      .values({ id, name: "Test", email: `${id}@example.com` });
    await credits.grantCredits({
      userId: id,
      amount: balance,
      source: "test",
      sourceId: randomUUID(),
    });
    return id;
  }

  /**
   * One "instance": the video service + the recovery sweep, sharing an adjustable clock and
   * provider. A process restart = building another instance against the same database.
   */
  function instance({
    clock = { now: Date.now() },
    storage = new MemoryStorage(),
    provider = { next: { status: "pending" } as VideoTaskStatus },
  } = {}) {
    const client = {
      start: vi.fn(async () => ({ taskId: `task-${randomUUID()}` })),
      status: vi.fn(async () => provider.next),
    } satisfies VideoClient;
    const fetch = vi.fn(async () => new Response(mp4));
    const logError = vi.fn();
    const video = createVideoService({
      db: dbClient.db,
      config,
      credits,
      checkRateLimit: async () => allowed,
      getClient: () => client,
      getStorage: () => storage,
      fileUrl: async (key) => `https://files.test/${key}`,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock.now,
      logError,
    });
    const scan = createAiRecovery({
      db: () => dbClient.db,
      credits,
      recoverVideo: video.recoverVideo,
      now: () => clock.now,
      logError,
    });
    return { ...video, scan, client, fetch, clock, storage, provider };
  }

  async function startVideo(s: ReturnType<typeof instance>, userId: string) {
    const started = await s.startVideo({ userId, prompt: "waves" });
    if (!started.ok) throw new Error(`unexpected ${started.status}`);
    return started.job.id;
  }

  /** The three places: the ai_usage row, this job's credit transactions, and the balance. */
  async function ledger(userId: string, usageId: string) {
    const [usage] = await dbClient.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, usageId));
    // Deduction transactions hang off ai_usage.id; a refund transaction has source refund and its
    // sourceId is the deduction being refunded.
    const deductions = await dbClient.db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.source, AI_CREDIT_SOURCE),
          eq(creditTransactions.sourceId, usageId),
          eq(creditTransactions.type, "deduct"),
        ),
      );
    const refunds = deductions.length
      ? await dbClient.db
          .select({ id: creditTransactions.id })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.type, "refund"),
              inArray(
                creditTransactions.sourceId,
                deductions.map((d) => String(d.id)),
              ),
            ),
          )
      : [];
    return {
      usage: usage!,
      deducted: deductions.length,
      refunded: refunds.length,
      balance: await credits.getBalance(userId),
    };
  }

  test("user closes the page: with no polling at all, the sweep saves the finished video to history and refunds nothing", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "succeeded", videoUrl: VIDEO_URL };

    // Freshly submitted jobs are outside the sweep: the frontend may still be polling, and the
    // taskId may not be written back yet.
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ scanned: 0 });
    expect(s.client.status).not.toHaveBeenCalled();

    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    expect(await s.scan({ userIds: [userId] })).toEqual({
      scanned: 1,
      succeeded: 1,
      failed: 0,
      pending: 0,
      errors: 0,
    });

    const state = await ledger(userId, id);
    expect(state.usage).toMatchObject({ status: "succeeded" });
    expect(state.usage.recoveryCheckedAt).not.toBeNull();
    expect(state).toMatchObject({ deducted: 1, refunded: 0, balance: 30 });
    const [file] = await dbClient.db
      .select()
      .from(files)
      .where(eq(files.id, state.usage.fileId!));
    expect(file).toMatchObject({ userId, mime: "video/mp4" });
    expect(s.storage.bodies.get(file!.key)).toEqual(mp4);

    // The user comes back (same on another device): the query gets the result directly, without
    // asking the provider or downloading again.
    const calls = s.client.status.mock.calls.length;
    const back = await s.pollVideo({ userId, id });
    expect(back.ok && back.job.status).toBe("succeeded");
    expect(s.client.status).toHaveBeenCalledTimes(calls);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  test("process restart (redeploy): the new instance sweeps up and handles pending rows left by the old one", async () => {
    const userId = await newUser(50);
    const provider = { next: { status: "pending" } as VideoTaskStatus };
    const before = instance({ provider });
    const id = await startVideo(before, userId);

    // The old instance is gone, leaving a single pending row in the database; the new instance
    // starts with the same provider account.
    const clock = { now: before.clock.now + 10 * MINUTE };
    const after = instance({ provider, clock });
    provider.next = { status: "succeeded", videoUrl: VIDEO_URL };
    expect(await after.scan({ userIds: [userId] })).toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "succeeded" },
      refunded: 0,
      balance: 30,
    });
  });

  test("scenario 3: provider has a result but saving locally fails — save the result first, no refund, not even after 30 minutes", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "succeeded", videoUrl: VIDEO_URL };
    s.fetch.mockImplementation(
      async () => new Response("down", { status: 503 }),
    );

    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "pending" },
      refunded: 0,
      balance: 30,
    });

    // 30 minutes is the limit for "the provider has no result yet"; the result is already at the
    // provider, so that limit can't trigger a refund.
    s.clock.now += VIDEO_TIMEOUT_MS;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "pending" },
      refunded: 0,
    });

    // Storage recovers: the next sweep saves the result.
    s.fetch.mockImplementation(async () => new Response(mp4));
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ succeeded: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "succeeded" },
      deducted: 1,
      refunded: 0,
      balance: 30,
    });
    expect(s.storage.objects.size).toBe(1);
  });

  test("saving keeps failing until the provider result expires (24 hours): only then refund as failed", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "succeeded", videoUrl: VIDEO_URL };
    s.fetch.mockImplementation(
      async () => new Response("gone", { status: 403 }),
    );

    s.clock.now += VIDEO_RESULT_TTL_MS + 1000;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ failed: 1 });
    const state = await ledger(userId, id);
    expect(state).toMatchObject({ refunded: 1, balance: 50 });
    expect(state.usage.status).toBe("failed");
    expect(state.usage.error).toContain("403");
  });

  test("provider has no result for a long time: kept for 30 minutes, then settled as failed and refunded with the reason in error", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);

    s.clock.now += 20 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(s.client.status).toHaveBeenCalledTimes(1);

    s.clock.now += 11 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ failed: 1 });
    // Even at the limit the provider is asked first (the second query); it doesn't refund on time
    // alone.
    expect(s.client.status).toHaveBeenCalledTimes(2);
    expect(await ledger(userId, id)).toMatchObject({
      usage: {
        status: "failed",
        error: "timeout: provider returned no result within 30 minutes",
      },
      refunded: 1,
      balance: 50,
    });
  });

  test("provider fails explicitly: the sweep settles it as failed and refunds", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = {
      status: "failed",
      error: "FAILED: DataInspectionFailed",
    };
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ failed: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "failed", error: "FAILED: DataInspectionFailed" },
      refunded: 1,
      balance: 50,
    });
  });

  test("process dies during submission before recording taskId: nothing to query, refunded after 30 minutes with the reason recorded", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    await dbClient.db
      .update(aiUsage)
      .set({ operation: null })
      .where(eq(aiUsage.id, id));

    s.clock.now += 10 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(s.client.status).not.toHaveBeenCalled();

    s.clock.now += VIDEO_TIMEOUT_MS;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ failed: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: {
        status: "failed",
        error:
          "timeout: no provider task id recorded (submission was interrupted)",
      },
      refunded: 1,
      balance: 50,
    });
  });

  test("scenario 2: client polling and the sweep settle the same row at once — success is saved once, failure refunded once", async () => {
    const userId = await newUser(100);
    const s = instance();
    const done = await startVideo(s, userId);
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;

    s.provider.next = { status: "succeeded", videoUrl: VIDEO_URL };
    await Promise.all([
      s.pollVideo({ userId, id: done }),
      s.pollVideo({ userId, id: done }),
      s.scan({ userIds: [userId] }),
    ]);
    const doneState = await ledger(userId, done);
    expect(doneState).toMatchObject({
      usage: { status: "succeeded" },
      deducted: 1,
      refunded: 0,
    });
    const saved = await dbClient.db
      .select()
      .from(files)
      .where(eq(files.userId, userId));
    expect(saved).toHaveLength(1);

    const broken = await startVideo(s, userId);
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    s.provider.next = { status: "failed", error: "FAILED" };
    await Promise.all([
      s.pollVideo({ userId, id: broken }),
      s.pollVideo({ userId, id: broken }),
      s.scan({ userIds: [userId] }),
      s.scan({ userIds: [userId] }),
    ]);
    expect(await ledger(userId, broken)).toMatchObject({
      usage: { status: "failed" },
      deducted: 1,
      refunded: 1,
    });
    // 100 - 20 (the successful one) - 20 + 20 (the failed one, refunded)
    expect(await credits.getBalance(userId)).toBe(80);
  });

  test("text / image: function reclaimed before settling is refunded past the limit; rows under the limit are left alone", async () => {
    const userId = await newUser(50);
    const s = instance();
    const deps = { db: () => dbClient.db, credits, logError: vi.fn() };
    const model = {
      id: "gpt",
      provider: "openai",
      model: "gpt-x",
      creditCost: 5,
    };
    const text = await reserveUsage(deps, { userId, kind: "text", model });
    const image = await reserveUsage(deps, {
      userId,
      kind: "image",
      model,
      prompt: "cat",
    });
    expect(await credits.getBalance(userId)).toBe(40);

    s.clock.now += 5 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ scanned: 0 });

    s.clock.now += RECOVERY_SYNC_HARD_LIMIT_MS;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({
      scanned: 2,
      failed: 2,
    });
    for (const id of [text!, image!]) {
      const state = await ledger(userId, id);
      expect(state).toMatchObject({ deducted: 1, refunded: 1 });
      expect(state.usage.status).toBe("failed");
      expect(state.usage.error).toMatch(/^interrupted:/);
    }
    expect(await credits.getBalance(userId)).toBe(50);
  });

  test("reentrant: sweeping the same jobs twice gives the same result without settling twice", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "failed", error: "FAILED" };
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    await s.scan({ userIds: [userId] });
    const first = await ledger(userId, id);
    // Finished rows no longer show up in the sweep.
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ scanned: 0 });
    const second = await ledger(userId, id);
    expect(second).toMatchObject({
      usage: { status: first.usage.status },
      refunded: 1,
      balance: first.balance,
    });
  });

  test("rotates under a limited quota: rows that can't settle yet don't hog the quota on every sweep", async () => {
    const userId = await newUser(100);
    const s = instance();
    const stuck = await startVideo(s, userId);
    const other = await startVideo(s, userId);
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    // The provider keeps saying "still generating": neither row can settle, but each sweep should
    // look at a different one.
    await s.scan({ userIds: [userId], limit: 1 });
    await s.scan({ userIds: [userId], limit: 1 });
    const checked = await dbClient.db
      .select({ id: aiUsage.id, at: aiUsage.recoveryCheckedAt })
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId));
    expect(checked.map((r) => r.at !== null)).toEqual([true, true]);
    expect(checked.map((r) => r.id).sort()).toEqual([stuck, other].sort());
  });
});
