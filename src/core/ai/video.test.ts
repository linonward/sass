// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq } from "drizzle-orm";
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
import { listPendingVideos } from "./generations";
import { createVideoService, VIDEO_TIMEOUT_MS } from "./video";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping video tests: DATABASE_URL_TEST is not set (see .env.example)",
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
    {
      id: "i2v",
      provider: "alibaba",
      model: "wan2.7-i2v",
      input: "image",
      creditCost: 20,
      duration: 10,
      resolution: "1080P",
    },
  ],
  defaultVideoModel: "t2v",
});

const allowed: RateLimitResult = { ok: true, retryAfter: 0 };
const VIDEO_URL = "https://dashscope-result.test/v.mp4";
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

/** Controllable video client: status returns the current value of next. */
function mockClient() {
  const state: { next: VideoTaskStatus } = { next: { status: "pending" } };
  const client = {
    start: vi.fn(async () => ({ taskId: "task-1" })),
    status: vi.fn(async () => state.next),
  } satisfies VideoClient;
  return { client, state };
}

describe.skipIf(!url)("videoService", () => {
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
    const id = `video-test-${randomUUID()}`;
    await dbClient.db
      .insert(user)
      .values({ id, name: "Test", email: `${id}@example.com` });
    if (balance > 0) {
      await credits.grantCredits({
        userId: id,
        amount: balance,
        source: "test",
        sourceId: randomUUID(),
      });
    }
    return id;
  }

  async function imageFile(userId: string, mime = "image/png") {
    const [file] = await dbClient.db
      .insert(files)
      .values({
        userId,
        key: `${userId}/2026-09/${randomUUID()}.png`,
        size: 1,
        mime,
        status: "uploaded",
      })
      .returning();
    return file!;
  }

  function setup({
    rateLimit = allowed,
    storage = new MemoryStorage() as MemoryStorage | null,
    clock = { now: Date.now() },
  } = {}) {
    const { client, state } = mockClient();
    const fetch = vi.fn(async () => new Response(mp4));
    const service = createVideoService({
      db: dbClient.db,
      config,
      credits,
      checkRateLimit: async () => rateLimit,
      getClient: () => client,
      getStorage: () => storage,
      fileUrl: async (key) => `https://files.test/${key}`,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock.now,
      logError: vi.fn(),
    });
    return { ...service, client, state, storage, fetch, clock };
  }

  async function usageRow(id: string) {
    const [row] = await dbClient.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, id));
    return row!;
  }

  async function refunds(userId: string) {
    return dbClient.db
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.type, "refund"),
        ),
      );
  }

  test("text-to-video: submitting deducts credits and records taskId; on completion copies to R2, and repeated queries don't download again", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({
      userId,
      prompt: " waves ",
      aspectRatio: "9:16",
    });
    if (!started.ok) throw new Error(`unexpected ${started.status}`);
    const { id } = started.job;
    expect(started.job.status).toBe("pending");
    expect(s.client.start).toHaveBeenCalledWith({
      model: "wan2.7-t2v",
      prompt: "waves",
      firstFrameUrl: undefined,
      duration: 5,
      resolution: "720P",
      ratio: "9:16",
    });
    expect(await usageRow(id)).toMatchObject({
      kind: "video",
      status: "pending",
      credits: 20,
      prompt: "waves",
      operation: { taskId: "task-1" },
    });
    expect(await credits.getBalance(userId)).toBe(30);
    expect(await listPendingVideos(dbClient.db, userId)).toEqual([
      expect.objectContaining({ id, modelId: "t2v", prompt: "waves" }),
    ]);

    const pending = await s.pollVideo({ userId, id });
    expect(pending.ok && pending.job.status).toBe("pending");

    s.state.next = { status: "succeeded", videoUrl: VIDEO_URL };
    const done = await s.pollVideo({ userId, id });
    if (!done.ok || done.job.status !== "succeeded") {
      throw new Error("expected succeeded");
    }
    expect(s.fetch).toHaveBeenCalledWith(VIDEO_URL);
    const row = await usageRow(id);
    expect(row.status).toBe("succeeded");
    const [file] = await dbClient.db
      .select()
      .from(files)
      .where(eq(files.id, row.fileId!));
    expect(file).toMatchObject({ mime: "video/mp4", status: "uploaded" });
    expect(file!.key).toMatch(
      new RegExp(`^${userId}/\\d{4}-\\d{2}/${id}\\.mp4$`),
    );
    expect(s.storage!.bodies.get(file!.key)).toEqual(mp4);
    expect(done.job.generation).toMatchObject({
      id,
      kind: "video",
      url: `https://files.test/${file!.key}`,
      mime: "video/mp4",
    });

    const again = await s.pollVideo({ userId, id });
    expect(again.ok && again.job.status).toBe("succeeded");
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.client.status).toHaveBeenCalledTimes(2);
    expect(await listPendingVideos(dbClient.db, userId)).toEqual([]);
    expect(await credits.getBalance(userId)).toBe(30);
  });

  test("concurrent queries of the same finished job: only one files row is written and the status is succeeded", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    s.state.next = { status: "succeeded", videoUrl: VIDEO_URL };
    const results = await Promise.all(
      [1, 2, 3].map(() => s.pollVideo({ userId, id: started.job.id })),
    );
    expect(results.every((r) => r.ok && r.job.status === "succeeded")).toBe(
      true,
    );
    const rows = await dbClient.db
      .select()
      .from(files)
      .where(eq(files.userId, userId));
    expect(rows).toHaveLength(1);
  });

  test("image-to-video: the first frame uses the user's own image file URL; duration and resolution come from config", async () => {
    const userId = await newUser(50);
    const image = await imageFile(userId);
    const s = setup();
    const started = await s.startVideo({
      userId,
      prompt: "animate",
      modelId: "i2v",
      imageFileId: image.id,
      aspectRatio: "whatever",
    });
    if (!started.ok) throw new Error(`unexpected ${started.status}`);
    expect(s.client.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "wan2.7-i2v",
        firstFrameUrl: `https://files.test/${image.key}`,
        duration: 10,
        resolution: "1080P",
        ratio: undefined,
      }),
    );
  });

  test("image-to-video returns 400 when the first frame isn't the user's own image, deducting no credits", async () => {
    const userId = await newUser(50);
    const other = await newUser(0);
    const s = setup();
    for (const imageFileId of [
      undefined,
      "nope",
      (await imageFile(other)).id,
      (await imageFile(userId, "application/pdf")).id,
    ]) {
      const result = await s.startVideo({
        userId,
        prompt: "animate",
        modelId: "i2v",
        imageFileId,
      });
      if (result.ok) throw new Error("expected 400");
      expect(result.status).toBe(400);
      expect(await result.response.json()).toEqual({ error: "invalid_image" });
    }
    expect(s.client.start).not.toHaveBeenCalled();
    expect(await credits.getBalance(userId)).toBe(50);
  });

  test("submission fails: 502, credits refunded", async () => {
    const userId = await newUser(50);
    const s = setup();
    s.client.start.mockRejectedValueOnce(new Error("provider down"));
    const result = await s.startVideo({ userId, prompt: "hi" });
    if (result.ok) throw new Error("expected failure");
    expect(result.status).toBe(502);
    expect(await credits.getBalance(userId)).toBe(50);
    expect(await refunds(userId)).toHaveLength(1);
  });

  test("job fails: refunded once, and only once even under concurrent queries", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    s.state.next = { status: "failed", error: "FAILED: DataInspectionFailed" };
    const results = await Promise.all(
      [1, 2, 3].map(() => s.pollVideo({ userId, id: started.job.id })),
    );
    expect(results.every((r) => r.ok && r.job.status === "failed")).toBe(true);
    expect(await refunds(userId)).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(50);
    expect(await usageRow(started.job.id)).toMatchObject({
      status: "failed",
      error: "FAILED: DataInspectionFailed",
    });
    // Among concurrent queries, once the first to finish has marked the job failed, later ones read
    // the database directly without asking the provider, so the call count is 1 to 3; what matters
    // is a single refund (checked above). Finished jobs are no longer queried.
    const calls = s.client.status.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(3);
    const later = await s.pollVideo({ userId, id: started.job.id });
    expect(later.ok && later.job.status).toBe("failed");
    expect(s.client.status).toHaveBeenCalledTimes(calls);
  });

  test("still unfinished at timeout: refunded and recorded as failed", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    s.clock.now += VIDEO_TIMEOUT_MS + 1000;
    const result = await s.pollVideo({ userId, id: started.job.id });
    expect(result.ok && result.job.status).toBe("failed");
    expect(await credits.getBalance(userId)).toBe(50);
    expect((await usageRow(started.job.id)).error).toBe(
      "timeout: provider returned no result within 30 minutes",
    );
  });

  test("query errors and download failures before the timeout are both treated as transient", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    s.client.status.mockRejectedValueOnce(new Error("network"));
    const r1 = await s.pollVideo({ userId, id: started.job.id });
    expect(r1.ok && r1.job.status).toBe("pending");
    s.state.next = { status: "succeeded", videoUrl: VIDEO_URL };
    s.fetch.mockResolvedValueOnce(new Response("gone", { status: 403 }));
    const r2 = await s.pollVideo({ userId, id: started.job.id });
    expect(r2.ok && r2.job.status).toBe("pending");
    const r3 = await s.pollVideo({ userId, id: started.job.id });
    expect(r3.ok && r3.job.status).toBe("succeeded");
    expect(await refunds(userId)).toHaveLength(0);
  });

  test("without storage configured: failed jobs are refunded as usual, finished jobs wait for storage", async () => {
    const userId = await newUser(50);
    const storage = new MemoryStorage();
    const s = setup({ storage });
    const a = await s.startVideo({ userId, prompt: "a" });
    const b = await s.startVideo({ userId, prompt: "b" });
    if (!a.ok || !b.ok) throw new Error("unexpected");
    const noStorage = createVideoService({
      db: dbClient.db,
      config,
      credits,
      checkRateLimit: async () => allowed,
      getClient: () => s.client,
      getStorage: () => null,
      fileUrl: async (key) => key,
      logError: vi.fn(),
    });
    s.state.next = { status: "failed", error: "FAILED" };
    const failed = await noStorage.pollVideo({ userId, id: a.job.id });
    expect(failed.ok && failed.job.status).toBe("failed");
    s.state.next = { status: "succeeded", videoUrl: VIDEO_URL };
    const waiting = await noStorage.pollVideo({ userId, id: b.job.id });
    expect(waiting.ok && waiting.job.status).toBe("pending");
    expect(await credits.getBalance(userId)).toBe(30);
  });

  test("404 for another user's job or a nonexistent id; 401 when signed out", async () => {
    const userId = await newUser(50);
    const other = await newUser(0);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    for (const [uid, id, status] of [
      [other, started.job.id, 404],
      [userId, randomUUID(), 404],
      [userId, "not-a-uuid", 404],
      [null, started.job.id, 401],
    ] as const) {
      const result = await s.pollVideo({ userId: uid, id });
      expect(result.ok || result.status).toBe(status);
    }
  });

  test("pre-submission checks: 402 insufficient balance, 429 over the limit, 503 no storage configured, 400 bad params", async () => {
    const userId = await newUser(10);
    const cases = [
      [setup(), { prompt: "hi" }, 402, "insufficient_credits"],
      [setup({ storage: null }), { prompt: "hi" }, 503, "storage_unavailable"],
      [setup(), { prompt: "" }, 400, "invalid_prompt"],
      [setup(), { prompt: "hi", modelId: "nope" }, 400, "invalid_model"],
      [
        setup(),
        { prompt: "hi", aspectRatio: "2:1" },
        400,
        "invalid_aspect_ratio",
      ],
    ] as const;
    for (const [s, input, status, error] of cases) {
      const result = await s.startVideo({ userId, ...input });
      if (result.ok) throw new Error("expected failure");
      expect(result.status).toBe(status);
      expect(await result.response.json()).toEqual({ error });
    }
    const limited = await setup({
      rateLimit: { ok: false, reason: "limited", retryAfter: 5 },
    }).startVideo({ userId, prompt: "hi" });
    expect(limited.ok || limited.status).toBe(429);
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test("race between the copy and timeout settlement: no double win of video plus refund and no orphaned object", async () => {
    const userId = await newUser(50);
    const storage = new MemoryStorage();
    const s = setup({ storage });
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    const { id } = started.job;
    s.state.next = { status: "succeeded", videoUrl: VIDEO_URL };

    // Inject a concurrent query in the window between "download finished" and "writing to the
    // database": it sees the job still running but past the timeout threshold, so it refunds and
    // sets failed — exactly the interleaving you get when the user has two tabs open.
    const put = storage.putObject.bind(storage);
    vi.spyOn(storage, "putObject").mockImplementationOnce(async (input) => {
      await put(input);
      s.state.next = { status: "pending" };
      s.clock.now += VIDEO_TIMEOUT_MS + 1000;
      const settled = await s.pollVideo({ userId, id });
      expect(settled.ok && settled.job.status).toBe("failed");
      s.clock.now -= VIDEO_TIMEOUT_MS + 1000;
    });

    const raced = await s.pollVideo({ userId, id });

    // The later call must not report success — otherwise the user gets both the video and the
    // refund.
    expect(raced.ok && raced.job.status).toBe("failed");
    expect(await refunds(userId)).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(50);
    expect((await usageRow(id)).status).toBe("failed");
    // No orphans: the files row is deleted and the object is removed from storage too.
    const rows = await dbClient.db
      .select()
      .from(files)
      .where(eq(files.userId, userId));
    expect(rows).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(1);
  });

  test("a failed refund doesn't lock in the terminal state: the transaction rolls back and the next query retries and refunds", async () => {
    const userId = await newUser(50);
    const s = setup();
    const started = await s.startVideo({ userId, prompt: "hi" });
    if (!started.ok) throw new Error("unexpected");
    const { id } = started.job;
    s.state.next = { status: "failed", error: "FAILED: DataInspectionFailed" };

    const refundSpy = vi
      .spyOn(credits, "refundCredits")
      .mockRejectedValueOnce(new Error("db down"));
    try {
      const first = await s.pollVideo({ userId, id });
      expect(first.ok && first.job.status).toBe("failed");
      // Status and refund share a transaction: refund fails → the status rolls back with it, stays
      // pending, and can be retried next time.
      expect((await usageRow(id)).status).toBe("pending");
      expect(await refunds(userId)).toHaveLength(0);
      expect(await credits.getBalance(userId)).toBe(30);
    } finally {
      refundSpy.mockRestore();
    }

    const second = await s.pollVideo({ userId, id });
    expect(second.ok && second.job.status).toBe("failed");
    expect((await usageRow(id)).status).toBe("failed");
    expect(await refunds(userId)).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(50);
  });
});
