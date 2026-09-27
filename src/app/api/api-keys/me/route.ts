import { createApiKeyMiddleware, withApiKey } from "@/core/api-keys/middleware";
import { createApiKeyRateLimiter } from "@/core/api-keys/rate-limit";
import { createApiKeyService } from "@/core/api-keys/service";
import { db } from "@/core/db";
import { runAfterResponse } from "@/core/lib/after-response";
import siteConfig from "../../../../../site.config";

const service = createApiKeyService(db);

const middleware = createApiKeyMiddleware({
  enabled: siteConfig.apiKeys.enabled,
  findKeyByHash: (hashedKey) => service.findByHash(hashedKey),
  // 记使用时间不阻塞响应。
  touchLastUsed: (keyId) =>
    runAfterResponse(() => service.touchLastUsed(keyId)),
  checkRateLimit: createApiKeyRateLimiter({
    perKey: siteConfig.apiKeys.rateLimitPerKey,
    rateLimit: siteConfig.rateLimit,
  }),
});

/**
 * `GET /api/api-keys/me`：示例接口，用 `Authorization: Bearer sk_...` 认出调用用户，
 * 返回 `{ userId, keyId, name, prefix }`。业务要暴露自己的 API 时照抄这个文件的接线
 * （`withApiKey` + 上面的中间件），把处理函数换成自己的逻辑。
 *
 * 鉴权失败一律 401，未开启 apiKeys 时 404；超限时按限流策略 429 / 503。
 */
export const GET = withApiKey(middleware, (request) =>
  Response.json({
    userId: request.apiKey.userId,
    keyId: request.apiKey.keyId,
    name: request.apiKey.name,
    prefix: request.apiKey.prefix,
  }),
);
