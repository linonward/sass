import { logger, type LogFn } from "@/core/observability/logger";
import { rateLimitResponse, type RateLimitResult } from "@/core/ratelimit";

import { hashApiKey, isApiKeyFormat } from "./generate";
import { apiKeyStatus } from "./status";

/** 鉴权通过后注入到 request 上的身份。 */
export type ApiKeyContext = {
  userId: string;
  keyId: string;
  name: string;
  prefix: string;
};

/** 库里的一行（已撤销 / 已过期的也照常返回，由中间件判定）。 */
export type ApiKeyLookup = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type ApiKeyAuthResult =
  { ok: true; apiKey: ApiKeyContext } | { ok: false; response: Response };

export type ApiKeyMiddlewareDeps = {
  /** `siteConfig.apiKeys.enabled`。关闭时任何带 key 的请求都按 404 处理。 */
  enabled: boolean;
  /** 按 `hashedKey` 查一把 key；查不到返回 null。 */
  findKeyByHash: (hashedKey: string) => Promise<ApiKeyLookup | null>;
  /**
   * 记一次使用时间。不参与鉴权判定：它抛错只记一条日志（记不上时间不该让请求失败）。
   * 也不需要等它结束 —— 路由那边用 `runAfterResponse` 包一层。
   */
  touchLastUsed?: (keyId: string) => Promise<void>;
  /** per-key 限流；返回 null 表示放行。不传就是完全不限流。 */
  checkRateLimit?: (keyId: string) => Promise<RateLimitResult | null>;
  now?: () => Date;
  logError?: LogFn;
};

/** 从 `Authorization` 头里取 Bearer token；不是 Bearer 或为空时返回 null。 */
export function bearerToken(header: string | null) {
  if (!header) return null;
  // 头值两侧的空格按规范会被剥掉，这里也容忍一下（多空格同理）。
  const [scheme, ...rest] = header.trim().split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return rest.join(" ").trim() || null;
}

function fail(error: "unauthorized" | "not_found", status: 401 | 404) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * API Key 鉴权中间件。不在 `src/core` 里全局挂载 —— 套件的路由不认 key，
 * 需要识别调用用户的 API 路由自己选这个中间件（见 `withApiKey`）。
 *
 * 失败一律返回同一种 401（格式不对、查不到、已撤销、已过期都不区分），
 * 免得把「这把 key 存在但失效了」告诉调用方。
 */
export function createApiKeyMiddleware({
  enabled,
  findKeyByHash,
  touchLastUsed,
  checkRateLimit,
  now = () => new Date(),
  logError = logger.error,
}: ApiKeyMiddlewareDeps) {
  return {
    async authenticate(request: Request): Promise<ApiKeyAuthResult> {
      if (!enabled) return { ok: false, response: fail("not_found", 404) };

      const token = bearerToken(request.headers.get("authorization"));
      if (!token || !isApiKeyFormat(token)) {
        return { ok: false, response: fail("unauthorized", 401) };
      }

      const row = await findKeyByHash(hashApiKey(token));
      if (!row || apiKeyStatus(row, now()) !== "active") {
        return { ok: false, response: fail("unauthorized", 401) };
      }

      if (checkRateLimit) {
        const limited = await checkRateLimit(row.id);
        if (limited && !limited.ok)
          return { ok: false, response: rateLimitResponse(limited) };
      }

      try {
        await touchLastUsed?.(row.id);
      } catch (error) {
        // 记使用时间失败不影响这次鉴权：它是运营信息，不是安全判定。
        logError("apiKeys.touch_last_used_failed", { error, keyId: row.id });
      }

      return {
        ok: true,
        apiKey: {
          userId: row.userId,
          keyId: row.id,
          name: row.name,
          prefix: row.prefix,
        },
      };
    },
  };
}

/** 挂了身份的 request：`request.apiKey.userId` / `.keyId`。 */
export type ApiKeyRequest = Request & { apiKey: ApiKeyContext };

/**
 * 把鉴权结果挂到 request 上再交给处理函数，路由里这样用：
 *
 * ```ts
 * export const GET = withApiKey(middleware, (request) =>
 *   Response.json({ userId: request.apiKey.userId }),
 * );
 * ```
 */
export function withApiKey(
  middleware: ReturnType<typeof createApiKeyMiddleware>,
  handler: (request: ApiKeyRequest) => Response | Promise<Response>,
) {
  return async function handleApiKeyRequest(request: Request) {
    const result = await middleware.authenticate(request);
    if (!result.ok) return result.response;
    return handler(Object.assign(request, { apiKey: result.apiKey }));
  };
}
