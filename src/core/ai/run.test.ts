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
  console.warn(
    "Skipping AI tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
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

/** Mock model that streams "Hello, world!". */
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

/** Fails as soon as it's called (e.g. an invalid key or a provider 5xx). */
function throwingModel() {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error("provider down");
    },
  });
}

/** Fails mid-stream after emitting some output. */
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
      // Only openai has a key configured.
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

  test("success: deducts the configured credits and ai_usage records tokens, credits, status, and duration", async () => {
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

  test("toUIMessageStreamResponse streams, and the server-side consumeStream doesn't affect client reads", async () => {
    const userId = await newUser(10);
    const { runAI } = setup();
    const run = await runAI({ userId, prompt: "Hi" });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    const body = await run.result.toUIMessageStreamResponse().text();
    expect(body).toContain("Hello, ");
    expect(body).toContain("world!");
    expect(await run.settled).toBe("succeeded");
  });

  test("returns 402 on insufficient balance, writes no ai_usage, and leaves the balance unchanged", async () => {
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
    ["fails on call", throwingModel],
    ["fails mid-stream", midStreamErrorModel],
  ])(
    "model failure (%s): credits are refunded and the transactions include a matching refund",
    async (_, model) => {
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
    },
  );

  test("returns 429 with Retry-After over the limit, deducting no credits and not calling the model", async () => {
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

  test("returns 503 when Redis is unavailable and failMode is closed", async () => {
    const userId = await newUser(10);
    const { runAI } = setup({
      rateLimit: { ok: false, reason: "unavailable", retryAfter: 30 },
    });
    const run = await runAI({ userId, prompt: "Hi" });
    expect(run.ok ? 200 : run.status).toBe(503);
  });

  test("401 when signed out, 400 for an unknown model, 503 when the provider has no key, deducting no credits in any case", async () => {
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

  test("free models deduct no credits but still record usage", async () => {
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

  test("passes the model's configured reasoning to the model, with the caller's value taking precedence", async () => {
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

  test("caller aborts: recorded as aborted, credits not refunded", async () => {
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

  test("refunds credits for invalid arguments too (both prompt and messages passed)", async () => {
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

  test("refunds a given call only once", async () => {
    const userId = await newUser(10);
    const { runAI } = setup({ model: midStreamErrorModel() });
    const run = await runAI({ userId, prompt: "Hi", maxRetries: 0 });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    await run.settled;
    // Wait for a possible second callback (onEnd) to run.
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
