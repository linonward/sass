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

// 恢复扫描的真库测试：每个场景都对照 ai_usage、credit_transactions 和余额三处状态。
// AI 调用不产生订单（orders），订单那一侧由计费模块的测试覆盖。

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过恢复扫描测试：未设置 DATABASE_URL_TEST（见 .env.example）");
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

describe.skipIf(!url)("AI 恢复扫描", () => {
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
   * 一个「实例」：视频服务 + 恢复扫描，共用一个可调的时钟和服务商。
   * 进程重启 = 再建一个实例，数据库还是同一个。
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

  /** 三处状态：ai_usage 行、这条任务的积分流水、余额。 */
  async function ledger(userId: string, usageId: string) {
    const [usage] = await dbClient.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, usageId));
    // 扣减流水挂在 ai_usage.id 上；退款流水的 source 是 refund、sourceId 是被退的那笔扣减。
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

  test("用户关掉页面：没有任何轮询，扫描把完成的视频存进历史，积分不退", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "succeeded", videoUrl: VIDEO_URL };

    // 刚提交的任务不在扫描范围里：前端可能还在轮询，taskId 也可能还没写回。
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

    // 用户回来（换设备也一样）：查询直接拿到结果，不再问服务商、不再下载。
    const calls = s.client.status.mock.calls.length;
    const back = await s.pollVideo({ userId, id });
    expect(back.ok && back.job.status).toBe("succeeded");
    expect(s.client.status).toHaveBeenCalledTimes(calls);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  test("进程重启（重新部署）：新实例扫到上一个实例遗留的 pending 并处理", async () => {
    const userId = await newUser(50);
    const provider = { next: { status: "pending" } as VideoTaskStatus };
    const before = instance({ provider });
    const id = await startVideo(before, userId);

    // 旧实例消失，数据库里只剩一行 pending；新实例拿同一个服务商账号起来。
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

  test("场景 3：服务商已出结果、本地保存失败 —— 先保存结果，不退款；超过 30 分钟也不退", async () => {
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

    // 30 分钟是「服务商还没出结果」的上限；结果已经在服务商那里，不能按它退款。
    s.clock.now += VIDEO_TIMEOUT_MS;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(await ledger(userId, id)).toMatchObject({
      usage: { status: "pending" },
      refunded: 0,
    });

    // 存储恢复：下一次扫描把结果存下来。
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

  test("保存一直失败到服务商结果过期（24 小时）：才按失败退款", async () => {
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

  test("供应商长期无结果：30 分钟前留着，之后结算失败并退款，error 写明原因", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);

    s.clock.now += 20 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ pending: 1 });
    expect(s.client.status).toHaveBeenCalledTimes(1);

    s.clock.now += 11 * MINUTE;
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ failed: 1 });
    // 到了上限也先问过服务商（第二次查询），不是看时间直接退。
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

  test("供应商明确失败：扫描结算失败并退款", async () => {
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

  test("提交时进程中断、没记下 taskId：没东西可查，30 分钟后退款并写明原因", async () => {
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

  test("场景 2：客户端轮询与扫描同时结算同一行 —— 成功只存一份，失败只退一次", async () => {
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
    // 100 - 20（成功的那条）- 20 + 20（失败退回）
    expect(await credits.getBalance(userId)).toBe(80);
  });

  test("文本 / 图片：函数在结算前被回收，超过上限后退款；未到上限的不碰", async () => {
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

  test("可重入：同一批任务扫两次，结果相同，不重复结算", async () => {
    const userId = await newUser(50);
    const s = instance();
    const id = await startVideo(s, userId);
    s.provider.next = { status: "failed", error: "FAILED" };
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    await s.scan({ userIds: [userId] });
    const first = await ledger(userId, id);
    // 已结束的行不再出现在扫描里。
    expect(await s.scan({ userIds: [userId] })).toMatchObject({ scanned: 0 });
    const second = await ledger(userId, id);
    expect(second).toMatchObject({
      usage: { status: first.usage.status },
      refunded: 1,
      balance: first.balance,
    });
  });

  test("名额有限时轮转：一时结不了的行不会每次都占住名额", async () => {
    const userId = await newUser(100);
    const s = instance();
    const stuck = await startVideo(s, userId);
    const other = await startVideo(s, userId);
    s.clock.now += RECOVERY_VIDEO_STALE_MS + 1000;
    // 服务商一直说「还在生成」：两条都结不了，但每次扫描要换一条看。
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
