// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { MockImageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { aiConfigSchema, type AiImageModel } from "@/core/config/schema";
import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import { aiUsage, creditTransactions, files, user } from "@/core/db/schema";
import type { RateLimitResult } from "@/core/ratelimit/limiter";
import { MemoryStorage } from "@/core/upload/testing";

import { listGenerations } from "./generations";
import { createRunImage } from "./image";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过图片测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

// PNG 文件头，generateImage 按它识别出 image/png。
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

/** 返回一张 PNG；doGenerate 是 vi.fn，可以断言调用参数。 */
function okModel() {
  return new MockImageModelV4({
    doGenerate: vi.fn(async () => ({
      images: [png],
      warnings: [],
      response: { timestamp: new Date(), modelId: "mock", headers: {} },
    })),
  });
}

const calls = (model: MockImageModelV4) =>
  vi.mocked(model.doGenerate).mock.calls.map(([options]) => options);

function throwingModel() {
  return new MockImageModelV4({
    doGenerate: async () => {
      throw new Error("provider down");
    },
  });
}

const config = aiConfigSchema.parse({
  imageModels: [
    { id: "img", provider: "alibaba", model: "qwen-image-3.0", creditCost: 4 },
    {
      id: "free-img",
      provider: "alibaba",
      model: "wan2.7-image",
      creditCost: 0,
    },
    { id: "gpt-img", provider: "openai", model: "gpt-image-1", creditCost: 4 },
  ],
  defaultImageModel: "img",
});

const allowed: RateLimitResult = { ok: true, retryAfter: 0 };

describe.skipIf(!url)("runImage", () => {
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
    const id = `img-test-${randomUUID()}`;
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
    storage = new MemoryStorage(),
  }: {
    model?: MockImageModelV4;
    rateLimit?: RateLimitResult;
    storage?: MemoryStorage | null;
  } = {}) {
    const checkRateLimit = vi.fn(async () => rateLimit);
    const runImage = createRunImage({
      db: client.db,
      config,
      credits,
      checkRateLimit,
      // 只有 alibaba 配了 key。
      getModel: (m: AiImageModel) => (m.provider === "alibaba" ? model : null),
      getStorage: () => storage,
      fileUrl: async (key) => `https://files.test/${key}`,
      logError: vi.fn(),
    });
    return { runImage, checkRateLimit, model, storage };
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

  test("成功：扣积分，图片写进存储和 files，ai_usage 记下类型、提示词和文件", async () => {
    const userId = await newUser(10);
    const { runImage, checkRateLimit, model, storage } = setup();

    const run = await runImage({
      userId,
      ip: "1.2.3.4",
      prompt: "  a boy on the beach  ",
      aspectRatio: "16:9",
    });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);

    expect(checkRateLimit).toHaveBeenCalledWith("ai", {
      userId,
      ip: "1.2.3.4",
    });
    expect(calls(model)[0]).toMatchObject({
      prompt: "a boy on the beach",
      aspectRatio: "16:9",
      n: 1,
    });
    const [file] = await client.db
      .select()
      .from(files)
      .where(eq(files.userId, userId));
    expect(file).toMatchObject({
      mime: "image/png",
      size: png.byteLength,
      status: "uploaded",
    });
    expect(file!.key).toMatch(new RegExp(`^${userId}/\\d{4}-\\d{2}/.+\\.png$`));
    expect(storage!.bodies.get(file!.key)).toEqual(png);
    expect(run.generation).toMatchObject({
      id: run.generation.id,
      kind: "image",
      modelId: "img",
      prompt: "a boy on the beach",
      url: `https://files.test/${file!.key}`,
      mime: "image/png",
    });
    expect(await usageRow(run.generation.id)).toMatchObject({
      kind: "image",
      status: "succeeded",
      credits: 4,
      prompt: "a boy on the beach",
      fileId: file!.id,
    });
    expect(await credits.getBalance(userId)).toBe(6);
  });

  test("生成记录：只列成功的图片，新的在前", async () => {
    const userId = await newUser(20);
    const { runImage } = setup();
    for (const prompt of ["first", "second"]) {
      const run = await runImage({ userId, prompt });
      if (!run.ok) throw new Error(`unexpected ${run.status}`);
    }
    await setup({ model: throwingModel() }).runImage({
      userId,
      prompt: "broken",
      maxRetries: 0,
    });
    const list = await listGenerations(
      { db: client.db, fileUrl: async (key) => `https://files.test/${key}` },
      { userId },
    );
    expect(list.map((g) => g.prompt)).toEqual(["second", "first"]);
    expect(list[0]!.url).toMatch(/^https:\/\/files\.test\//);
  });

  test("余额不足返回 402，不调用模型，不写 ai_usage", async () => {
    const userId = await newUser(3);
    const { runImage, model } = setup();
    const run = await runImage({ userId, prompt: "hi" });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.status).toBe(402);
    expect(await run.response.json()).toEqual({
      error: "insufficient_credits",
    });
    expect(calls(model)).toHaveLength(0);
    expect(
      await client.db.select().from(aiUsage).where(eq(aiUsage.userId, userId)),
    ).toHaveLength(0);
  });

  test("模型报错：返回 502，积分退回，记为 failed", async () => {
    const userId = await newUser(10);
    const { runImage, storage } = setup({ model: throwingModel() });
    const run = await runImage({ userId, prompt: "hi", maxRetries: 0 });
    if (run.ok) throw new Error("expected failure");
    expect(run.status).toBe(502);
    expect(await run.response.json()).toEqual({ error: "model_error" });
    expect(await credits.getBalance(userId)).toBe(10);
    const refunds = (await transactions(userId)).filter(
      (tx) => tx.type === "refund",
    );
    expect(refunds).toHaveLength(1);
    expect(storage!.objects.size).toBe(0);
    const [row] = await client.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId));
    expect(row).toMatchObject({ status: "failed", fileId: null });
    expect(row!.error).toContain("provider down");
  });

  test("存储写入失败：积分同样退回", async () => {
    const userId = await newUser(10);
    const storage = new MemoryStorage();
    storage.putObject = async () => {
      throw new Error("r2 down");
    };
    const { runImage } = setup({ storage });
    const run = await runImage({ userId, prompt: "hi" });
    if (run.ok) throw new Error("expected failure");
    expect(run.status).toBe(502);
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test("免费模型不扣积分", async () => {
    const userId = await newUser(0);
    const { runImage } = setup();
    const run = await runImage({ userId, prompt: "hi", modelId: "free-img" });
    if (!run.ok) throw new Error(`unexpected ${run.status}`);
    expect(await transactions(userId)).toHaveLength(0);
  });

  test("超限返回 429，限流服务不可用（closed）返回 503，都不扣积分", async () => {
    const userId = await newUser(10);
    const limited = await setup({
      rateLimit: { ok: false, reason: "limited", retryAfter: 30 },
    }).runImage({ userId, prompt: "hi" });
    if (limited.ok) throw new Error("expected 429");
    expect(limited.status).toBe(429);
    expect(limited.response.headers.get("Retry-After")).toBe("30");
    const down = await setup({
      rateLimit: { ok: false, reason: "unavailable", retryAfter: 0 },
    }).runImage({ userId, prompt: "hi" });
    if (down.ok) throw new Error("expected 503");
    expect(down.status).toBe(503);
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test.each([
    [{ prompt: "" }, 400, "invalid_prompt"],
    [{ prompt: "x".repeat(2001) }, 400, "invalid_prompt"],
    [{ prompt: 1 }, 400, "invalid_prompt"],
    [{ prompt: "hi", aspectRatio: "2:1" }, 400, "invalid_aspect_ratio"],
    [{ prompt: "hi", modelId: "nope" }, 400, "invalid_model"],
    [{ prompt: "hi", modelId: "gpt-img" }, 503, "model_unavailable"],
  ])("参数 %j 返回 %i %s", async (input, status, error) => {
    const userId = await newUser(10);
    const run = await setup().runImage({ userId, ...input });
    if (run.ok) throw new Error("expected failure");
    expect(run.status).toBe(status);
    expect(await run.response.json()).toEqual({ error });
    expect(await credits.getBalance(userId)).toBe(10);
  });

  test("未登录 401，没有配置存储 503", async () => {
    const noUser = await setup().runImage({ userId: null, prompt: "hi" });
    expect(noUser.ok || noUser.status).toBe(401);
    const userId = await newUser(10);
    const noStorage = await setup({ storage: null }).runImage({
      userId,
      prompt: "hi",
    });
    if (noStorage.ok) throw new Error("expected 503");
    expect(noStorage.status).toBe(503);
    expect(await noStorage.response.json()).toEqual({
      error: "storage_unavailable",
    });
  });
});
