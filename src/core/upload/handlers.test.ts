// @vitest-environment node
import { describe, expect, test, vi } from "vitest";

import { uploadConfigSchema } from "@/core/config/schema";
import type { Database } from "@/core/db";
import type { RateLimitResult } from "@/core/ratelimit/limiter";

import {
  handleComplete,
  handleFileRedirect,
  handlePresign,
  type UploadRouteContext,
} from "./handlers";
import { MemoryStorage } from "./testing";

// 这些用例都在写库之前返回；写库的路径见 service.test.ts。
const db = new Proxy({} as Database, {
  get: () => {
    throw new Error("database should not be used");
  },
});

function context(overrides: Partial<UploadRouteContext> = {}) {
  const checkRateLimit = vi.fn(async (): Promise<RateLimitResult> => ({
    ok: true,
    retryAfter: 0,
  }));
  const ctx: UploadRouteContext = {
    enabled: true,
    getUserId: async () => "u1",
    checkRateLimit,
    deps: () => ({
      db,
      storage: new MemoryStorage(),
      config: uploadConfigSchema.parse({}),
    }),
    ...overrides,
  };
  return { ...ctx, checkRateLimit };
}

const request = (body: unknown) =>
  new Request("https://sass.test/api/upload/presign", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    body: JSON.stringify(body),
  });

describe("上传路由", () => {
  test("features.upload 关闭时三个接口都返回 404", async () => {
    const ctx = context({ enabled: false });
    expect((await handlePresign(request({}), ctx)).status).toBe(404);
    expect((await handleComplete(request({}), ctx)).status).toBe(404);
    expect((await handleFileRedirect(request({}), "f", ctx)).status).toBe(404);
  });

  test("未登录返回 401，且不计入限流", async () => {
    const ctx = context({ getUserId: async () => null });
    expect((await handlePresign(request({}), ctx)).status).toBe(401);
    expect((await handleComplete(request({}), ctx)).status).toBe(401);
    expect((await handleFileRedirect(request({}), "f", ctx)).status).toBe(401);
    expect(ctx.checkRateLimit).not.toHaveBeenCalled();
  });

  test("预签名按用户和 IP 走 upload 限流，超限返回 429 和 Retry-After", async () => {
    const ctx = context();
    ctx.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      reason: "limited",
      retryAfter: 42,
    });
    const response = await handlePresign(
      request({ mime: "image/png", size: 1 }),
      ctx,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(ctx.checkRateLimit).toHaveBeenCalledWith("upload", {
      userId: "u1",
      ip: "1.2.3.4",
    });
  });

  test("类型或大小不合法时返回错误码", async () => {
    const ctx = context();
    const svg = await handlePresign(
      request({ mime: "image/svg+xml", size: 1 }),
      ctx,
    );
    expect(svg.status).toBe(400);
    expect(await svg.json()).toEqual({ error: "invalid_type" });

    const big = await handlePresign(
      request({ mime: "image/png", size: 11 * 1024 * 1024 }),
      ctx,
    );
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "too_large" });

    const junk = await handlePresign(
      new Request("https://sass.test/", { method: "POST", body: "not json" }),
      ctx,
    );
    expect(junk.status).toBe(400);
  });

  test("没有配置 R2 时返回 503", async () => {
    const ctx = context({
      deps: () => ({ db, storage: null, config: uploadConfigSchema.parse({}) }),
    });
    const response = await handlePresign(
      request({ mime: "image/png", size: 1 }),
      ctx,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upload_not_configured" });
  });
});
