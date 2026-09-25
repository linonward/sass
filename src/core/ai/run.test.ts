// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { aiConfigSchema, type AiModel } from "@/core/config/schema";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import { aiUsage, creditTransactions, user } from "@/core/db/schema";
import type { RateLimitResult } from "@/core/ratelimit/limiter";

import { AI_CREDIT_SOURCE, createRunAI } from "./run";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过 AI 测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

const usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

/** 流式返回 "Hello, world!" 的 mock 模型。 */
function okModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hello, " },
          { type: "text-delta", id: "t1", delta: "world!" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
}

/** 调用即报错（比如 key 失效、服务商 5xx）。 */
function throwingModel() {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error("provider down");
    },
  });
}

/** 输出一部分后在流中报错。 */
function midStreamErrorModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hel" },
          { type: "error", error: new Error("stream broke") },
        ],
      }),
    }),
  });
}

const config = aiConfigSchema.parse({
  models: [
    { id: "fast", provider: "openai", model: "gpt-5-mini", creditCost: 3 },
    { id: "free", provider: "openai", model: "gpt-5-nano", creditCost: 0 },
    {
      id: "no-think",
      provider: "openai",
      model: "gpt-5-mini",
      creditCost: 0,
      reasoning: "none",
    },
    {
      id: "claude",
      provider: "anthropic",
      model: "claude-sonnet-5",
      creditCost: 5,
    },
  ],
  defaultModel: "fast",
});

const allowed: RateLimitResult = { ok: true, retryAfter: 0 };

describe.skipIf(!url)("runAI", () => {
  let client: DbClient;
  let credits: Credits;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();
    client = createDbClient(url!);
    credits = createCredits({ db: client.db, enabled: true });
  });

  afterAll(async () => {
    await client?.close();
  });

  async function newUser(balance: number) {
    const id = `ai-test-${randomUUID()}`;
    await client.db
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

  function setup({
    model = okModel(),
    rateLimit = allowed,
  }: {
    model?: MockLanguageModelV4;
    rateLimit?: RateLimitResult;
  } = {}) {
    const checkRateLimit = vi.fn(async () => rateLimit);
    const logError = vi.fn();
    const runAI = createRunAI({
      db: client.db,
      config,
      credits,
      checkRateLimit,
      // 只有 openai 配了 key。
      getModel: (m: AiModel) => (m.provider === "openai" ? model : null),
      logError,
    });
    return { runAI, checkRateLimit, logError, model };
  }

  async function usageRow(id: string) {
    const [row] = await client.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, id));
    return row!;
  }

  async function transactions(userId: string) {
    return client.db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
  }

  test("成功：扣除配置的积分，ai_usage 记录 token、积分、状态和耗时", async () => {
    const userId = await newUser(10);
    const { runAI, checkRateLimit } = setup();

    const run = await runAI({ userId, ip: "1.2.3.4", prompt: "Hi" });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    expect(await run.result.text).toBe("Hello, world!");
    expect(await run.settled).toBe("succeeded");

    expect(checkRateLimit).toHaveBeenCalledWith("ai", {
      userId,
      ip: "1.2.3.4",
    });
    expect(await credits.getBalance(userId)).toBe(7);
    expect(await usageRow(run.usageId)).toMatchObject({
      userId,
      modelId: "fast",
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 3,
      outputTokens: 10,
      credits: 3,
      status: "succeeded",
      error: null,
    });
    const row = await usageRow(run.usageId);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.finishedAt).toBeInstanceOf(Date);

    const [deduct] = (await transactions(userId)).filter(
      (tx) => tx.type === "deduct",
    );
    expect(deduct).toMatchObject({
      amount: -3,
      source: AI_CREDIT_SOURCE,
      sourceId: run.usageId,
    });
  });

  test("toUIMessageStreamResponse 流式返回，服务端 consumeStream 不影响客户端读取", async () => {
    const userId = await newUser(10);
    const { runAI } = setup();
    const run = await runAI({ userId, prompt: "Hi" });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    const body = await run.result.toUIMessageStreamResponse().text();
    expect(body).toContain("Hello, ");
    expect(body).toContain("world!");
    expect(await run.settled).toBe("succeeded");
  });

  test("余额不足返回 402，不写 ai_usage，余额不变", async () => {
    const userId = await newUser(2);
    const { runAI, model } = setup();
    const run = await runAI({ userId, prompt: "Hi" });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.status).toBe(402);
    expect(await run.response.json()).toEqual({
      error: "insufficient_credits",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await credits.getBalance(userId)).toBe(2);
    expect(
      await client.db.select().from(aiUsage).where(eq(aiUsage.userId, userId)),
    ).toHaveLength(0);
  });

  test.each([
    ["调用即报错", throwingModel],
    ["流中报错", midStreamErrorModel],
  ])("模型失败（%s）：积分退回，流水里有对应的 refund", async (_, model) => {
    const userId = await newUser(10);
    const { runAI, logError } = setup({ model: model() });
    const run = await runAI({ userId, prompt: "Hi", maxRetries: 0 });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    expect(await run.settled).toBe("failed");

    expect(await credits.getBalance(userId)).toBe(10);
    const row = await usageRow(run.usageId);
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    expect(logError).toHaveBeenCalled();

    const txs = await transactions(userId);
    const deduct = txs.find((tx) => tx.type === "deduct")!;
    expect(deduct.sourceId).toBe(run.usageId);
    expect(txs.find((tx) => tx.type === "refund")).toMatchObject({
      amount: 3,
      source: "refund",
      sourceId: deduct.id,
    });
  });

  test("超限返回 429 和 Retry-After，不扣积分、不调用模型", async () => {
    const userId = await newUser(10);
    const { runAI, model } = setup({
      rateLimit: { ok: false, reason: "limited", retryAfter: 17 },
    });
    const run = await runAI({ userId, prompt: "Hi" });
    if (run.ok) throw new Error("expected rejection");
    expect(run.status).toBe(429);
    expect(run.response.headers.get("Retry-After")).toBe("17");
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test("Redis 不可用且 failMode 为 closed 时返回 503", async () => {
    const userId = await newUser(10);
    const { runAI } = setup({
      rateLimit: { ok: false, reason: "unavailable", retryAfter: 30 },
    });
    const run = await runAI({ userId, prompt: "Hi" });
    expect(run.ok ? 200 : run.status).toBe(503);
  });

  test("未登录 401，未知模型 400，服务商没配 key 503，都不扣积分", async () => {
    const userId = await newUser(10);
    const { runAI, checkRateLimit } = setup();
    const status = async (input: Parameters<typeof runAI>[0]) => {
      const run = await runAI(input);
      return run.ok ? 200 : run.status;
    };
    expect(await status({ userId: null, prompt: "Hi" })).toBe(401);
    expect(await status({ userId, modelId: "nope", prompt: "Hi" })).toBe(400);
    expect(await status({ userId, modelId: "claude", prompt: "Hi" })).toBe(503);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test("免费模型不扣积分，也记录用量", async () => {
    const userId = await newUser(0);
    const { runAI } = setup();
    const run = await runAI({ userId, modelId: "free", prompt: "Hi" });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    expect(await run.settled).toBe("succeeded");
    expect(await usageRow(run.usageId)).toMatchObject({
      credits: 0,
      status: "succeeded",
    });
    expect(await transactions(userId)).toHaveLength(0);
  });

  test("模型配置的 reasoning 传给模型，调用方传入的优先", async () => {
    const userId = await newUser(0);
    const { runAI, model } = setup();
    for (const reasoning of [undefined, "high"] as const) {
      const run = await runAI({
        userId,
        modelId: "no-think",
        prompt: "Hi",
        reasoning,
      });
      if (!run.ok) throw new Error(`unexpected ${run.status}`);
      await run.settled;
    }
    expect(model.doStreamCalls.map((call) => call.reasoning)).toEqual([
      "none",
      "high",
    ]);
  });

  test("调用方中止：记为 aborted，积分不退", async () => {
    const userId = await newUser(10);
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-start", id: "t1" });
            c.enqueue({ type: "text-delta", id: "t1", delta: "Hel" });
            abortSignal?.addEventListener("abort", () =>
              c.error(abortSignal.reason),
            );
          },
        }),
      }),
    });
    const { runAI } = setup({ model });
    const run = await runAI({
      userId,
      prompt: "Hi",
      abortSignal: controller.signal,
    });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    expect(await run.settled).toBe("aborted");
    expect(await credits.getBalance(userId)).toBe(7);
    expect(
      (await transactions(userId)).filter((tx) => tx.type === "refund"),
    ).toHaveLength(0);
  });

  test("参数非法（同时传 prompt 和 messages）时也退回积分", async () => {
    const userId = await newUser(10);
    const { runAI } = setup();
    const run = await runAI({
      userId,
      prompt: "Hi",
      messages: [{ role: "user", content: "Hi" }],
    } as never);
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    expect(await run.settled).toBe("failed");
    expect(await credits.getBalance(userId)).toBe(10);
    expect((await usageRow(run.usageId)).error).toContain("prompt");
  });

  test("同一次调用的退款只发生一次", async () => {
    const userId = await newUser(10);
    const { runAI } = setup({ model: midStreamErrorModel() });
    const run = await runAI({ userId, prompt: "Hi", maxRetries: 0 });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    await run.settled;
    // 等可能的第二次回调（onEnd）跑完。
    await new Promise((r) => setTimeout(r, 50));
    const refunds = await client.db
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.type, "refund"),
        ),
      );
    expect(refunds).toHaveLength(1);
    expect(await credits.getBalance(userId)).toBe(10);
  });
});
