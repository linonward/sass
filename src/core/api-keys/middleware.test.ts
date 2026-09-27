// @vitest-environment node
import { describe, expect, test, vi } from "vitest";

import { generateApiKey, hashApiKey } from "./generate";
import {
  bearerToken,
  createApiKeyMiddleware,
  withApiKey,
  type ApiKeyLookup,
} from "./middleware";
import { apiKeyStatus } from "./status";

const KEY_ID = "3f1b1c2e-0000-4000-8000-000000000001";

function lookup(overrides: Partial<ApiKeyLookup> = {}): ApiKeyLookup {
  return {
    id: KEY_ID,
    userId: "user-1",
    name: "Production",
    prefix: "sk_1a2b3c4d",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/api-keys/me", { headers });
}

function build(
  deps: Partial<Parameters<typeof createApiKeyMiddleware>[0]> = {},
) {
  return createApiKeyMiddleware({
    enabled: true,
    findKeyByHash: async () => null,
    ...deps,
  });
}

describe("bearerToken", () => {
  test.each([
    ["Bearer sk_abc", "sk_abc"],
    ["bearer sk_abc", "sk_abc"],
    ["  Bearer   sk_abc  ", "sk_abc"],
    ["Basic sk_abc", null],
    ["sk_abc", null],
    ["Bearer", null],
    ["Bearer   ", null],
    ["", null],
  ])("%o → %o", (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });

  test("没有 Authorization 头时为 null", () => {
    expect(bearerToken(null)).toBeNull();
  });
});

describe("createApiKeyMiddleware", () => {
  test("模块关闭时带有效 key 也 404", async () => {
    const findKeyByHash = vi.fn(async () => lookup());
    const { plaintext } = generateApiKey();
    const result = await build({ enabled: false, findKeyByHash }).authenticate(
      request({ authorization: `Bearer ${plaintext}` }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(404);
    // 关闭时连库都不查。
    expect(findKeyByHash).not.toHaveBeenCalled();
  });

  test("没有 Authorization 头 → 401", async () => {
    const result = await build().authenticate(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("不是 Bearer → 401", async () => {
    const result = await build().authenticate(
      request({ authorization: "Basic c2tfbG9s" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("格式不对（不是 sk_ + 64 hex）→ 401，且不查库", async () => {
    const findKeyByHash = vi.fn(async () => lookup());
    for (const value of ["sk_short", "nope", `sk_${"A".repeat(64)}`]) {
      const result = await build({ findKeyByHash }).authenticate(
        request({ authorization: `Bearer ${value}` }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    }
    expect(findKeyByHash).not.toHaveBeenCalled();
  });

  test("查不到 → 401", async () => {
    const { plaintext } = generateApiKey();
    const result = await build({
      findKeyByHash: async () => null,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("按哈希查库，不拿明文去查", async () => {
    const { plaintext, hashedKey } = generateApiKey();
    const findKeyByHash = vi.fn(async () => lookup());
    const result = await build({ findKeyByHash }).authenticate(
      request({ authorization: `Bearer ${plaintext}` }),
    );
    expect(result.ok).toBe(true);
    expect(findKeyByHash).toHaveBeenCalledWith(hashedKey);
    expect(findKeyByHash).not.toHaveBeenCalledWith(plaintext);
  });

  test("有效 key → 注入 userId / keyId / name / prefix", async () => {
    const { plaintext } = generateApiKey();
    const touchLastUsed = vi.fn(async () => {});
    const result = await build({
      findKeyByHash: async () => lookup(),
      touchLastUsed,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result).toEqual({
      ok: true,
      apiKey: {
        userId: "user-1",
        keyId: KEY_ID,
        name: "Production",
        prefix: "sk_1a2b3c4d",
      },
    });
    expect(touchLastUsed).toHaveBeenCalledWith(KEY_ID);
  });

  test("已撤销 → 401", async () => {
    const { plaintext } = generateApiKey();
    const touchLastUsed = vi.fn(async () => {});
    const result = await build({
      findKeyByHash: async () => lookup({ revokedAt: new Date(0) }),
      touchLastUsed,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  test("已过期 → 401；到点那一刻就算过期", async () => {
    const { plaintext } = generateApiKey();
    const now = new Date("2026-01-01T00:00:00Z");
    for (const expiresAt of [
      new Date(now.getTime() - 1),
      new Date(now.getTime()),
    ]) {
      const result = await build({
        findKeyByHash: async () => lookup({ expiresAt }),
        now: () => now,
      }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    }
    // 还没到点就照常放行。
    const alive = await build({
      findKeyByHash: async () =>
        lookup({ expiresAt: new Date(now.getTime() + 1) }),
      now: () => now,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(alive.ok).toBe(true);
  });

  test("撤销接口幂等：重复撤销后鉴权仍然是 401", async () => {
    const { plaintext } = generateApiKey();
    // 撤销两次以上的行长得一样（revokedAt 只写一次），鉴权结果不随调用次数变化。
    const middleware = build({
      findKeyByHash: async () => lookup({ revokedAt: new Date(0) }),
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await middleware.authenticate(
        request({ authorization: `Bearer ${plaintext}` }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    }
  });

  test("记使用时间抛错不影响鉴权，只记日志", async () => {
    const { plaintext } = generateApiKey();
    const logError = vi.fn();
    const result = await build({
      findKeyByHash: async () => lookup(),
      touchLastUsed: async () => {
        throw new Error("database is down");
      },
      logError,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      "apiKeys.touch_last_used_failed",
      expect.objectContaining({ keyId: KEY_ID }),
    );
  });

  test("超出 per-key 限流 → 429，带 Retry-After，且不记使用时间", async () => {
    const { plaintext } = generateApiKey();
    const touchLastUsed = vi.fn(async () => {});
    const result = await build({
      findKeyByHash: async () => lookup(),
      checkRateLimit: async () => ({
        ok: false,
        reason: "limited",
        retryAfter: 42,
      }),
      touchLastUsed,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("42");
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  test("限流放行（null / ok）时照常鉴权", async () => {
    const { plaintext } = generateApiKey();
    for (const checkRateLimit of [
      async () => null,
      async () => ({ ok: true, retryAfter: 0 }) as const,
    ]) {
      const result = await build({
        findKeyByHash: async () => lookup(),
        checkRateLimit,
      }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
      expect(result.ok).toBe(true);
    }
  });

  test("Redis 不可用（failMode closed）→ 503", async () => {
    const { plaintext } = generateApiKey();
    const result = await build({
      findKeyByHash: async () => lookup(),
      checkRateLimit: async () => ({
        ok: false,
        reason: "unavailable",
        retryAfter: 30,
      }),
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  test("响应不缓存", async () => {
    const result = await build().authenticate(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("withApiKey", () => {
  test("鉴权通过后处理函数能读到 request.apiKey", async () => {
    const { plaintext } = generateApiKey();
    const handler = vi.fn((request: Request & { apiKey: { userId: string } }) =>
      Response.json({ userId: request.apiKey.userId }),
    );
    const wrapped = withApiKey(
      build({ findKeyByHash: async () => lookup() }),
      handler,
    );
    const response = await wrapped(
      request({ authorization: `Bearer ${plaintext}` }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: "user-1" });
    expect(handler).toHaveBeenCalledOnce();
  });

  test("鉴权失败时处理函数不被调用", async () => {
    const handler = vi.fn(() => Response.json({ ok: true }));
    const wrapped = withApiKey(build(), handler);
    const response = await wrapped(request());
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("apiKeyStatus", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("撤销优先于过期", () => {
    expect(
      apiKeyStatus(
        {
          revokedAt: new Date("2025-06-01T00:00:00Z"),
          expiresAt: new Date("2025-06-01T00:00:00Z"),
        },
        now,
      ),
    ).toBe("revoked");
  });

  test("没有 expiresAt 就不过期", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe(
      "active",
    );
  });

  test("到点即过期", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: now }, now)).toBe(
      "expired",
    );
    expect(
      apiKeyStatus(
        { revokedAt: null, expiresAt: new Date(now.getTime() + 1000) },
        now,
      ),
    ).toBe("active");
  });

  test("哈希是十六进制字符串，长度和 sha256 一致", () => {
    expect(hashApiKey("hello")).toHaveLength(64);
  });
});
