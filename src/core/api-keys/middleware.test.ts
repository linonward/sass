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

  test("null when there is no Authorization header", () => {
    expect(bearerToken(null)).toBeNull();
  });
});

describe("createApiKeyMiddleware", () => {
  test("404 when the module is disabled, even with a valid key", async () => {
    const findKeyByHash = vi.fn(async () => lookup());
    const { plaintext } = generateApiKey();
    const result = await build({ enabled: false, findKeyByHash }).authenticate(
      request({ authorization: `Bearer ${plaintext}` }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(404);
    // When disabled, the database isn't even queried.
    expect(findKeyByHash).not.toHaveBeenCalled();
  });

  test("no Authorization header → 401", async () => {
    const result = await build().authenticate(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("not Bearer → 401", async () => {
    const result = await build().authenticate(
      request({ authorization: "Basic c2tfbG9s" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("wrong format (not sk_ + 64 hex) → 401, without a database lookup", async () => {
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

  test("not found → 401", async () => {
    const { plaintext } = generateApiKey();
    const result = await build({
      findKeyByHash: async () => null,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test("looks up by hash, never by plaintext", async () => {
    const { plaintext, hashedKey } = generateApiKey();
    const findKeyByHash = vi.fn(async () => lookup());
    const result = await build({ findKeyByHash }).authenticate(
      request({ authorization: `Bearer ${plaintext}` }),
    );
    expect(result.ok).toBe(true);
    expect(findKeyByHash).toHaveBeenCalledWith(hashedKey);
    expect(findKeyByHash).not.toHaveBeenCalledWith(plaintext);
  });

  test("valid key → attaches userId / keyId / name / prefix", async () => {
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

  test("revoked → 401", async () => {
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

  test("expired → 401; expired at the exact expiry moment", async () => {
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
    // Before the expiry time it's allowed as usual.
    const alive = await build({
      findKeyByHash: async () =>
        lookup({ expiresAt: new Date(now.getTime() + 1) }),
      now: () => now,
    }).authenticate(request({ authorization: `Bearer ${plaintext}` }));
    expect(alive.ok).toBe(true);
  });

  test("revoke is idempotent: after repeated revokes authentication is still 401", async () => {
    const { plaintext } = generateApiKey();
    // A row revoked two or more times looks the same (revokedAt is written only once), so the
    // auth result doesn't depend on how many times revoke was called.
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

  test("a throwing usage-time write doesn't affect authentication, it's only logged", async () => {
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

  test("over the per-key rate limit → 429 with Retry-After, and no usage time recorded", async () => {
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

  test("authenticates normally when the rate limit allows (null / ok)", async () => {
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

  test("Redis unavailable (failMode closed) → 503", async () => {
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

  test("responses are not cached", async () => {
    const result = await build().authenticate(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("withApiKey", () => {
  test("the handler can read request.apiKey after authentication passes", async () => {
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

  test("the handler isn't called when authentication fails", async () => {
    const handler = vi.fn(() => Response.json({ ok: true }));
    const wrapped = withApiKey(build(), handler);
    const response = await wrapped(request());
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("apiKeyStatus", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("revoked takes precedence over expired", () => {
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

  test("never expires without expiresAt", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe(
      "active",
    );
  });

  test("expires at the exact expiry time", () => {
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

  test("the hash is a hex string with sha256's length", () => {
    expect(hashApiKey("hello")).toHaveLength(64);
  });
});
