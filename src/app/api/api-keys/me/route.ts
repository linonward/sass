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
  // Recording last-used time doesn't block the response.
  touchLastUsed: (keyId) =>
    runAfterResponse(() => service.touchLastUsed(keyId)),
  checkRateLimit: createApiKeyRateLimiter({
    perKey: siteConfig.apiKeys.rateLimitPerKey,
    rateLimit: siteConfig.rateLimit,
  }),
});

/**
 * `GET /api/api-keys/me`: an example endpoint that identifies the caller from
 * `Authorization: Bearer sk_...` and returns `{ userId, keyId, name, prefix }`. To expose your own
 * API, copy this file's wiring (`withApiKey` + the middleware above) and swap in your own handler.
 *
 * Any auth failure is a 401, and 404 when apiKeys is off; over the limit it's 429 / 503 per the
 * rate limit policy.
 */
export const GET = withApiKey(middleware, (request) =>
  Response.json({
    userId: request.apiKey.userId,
    keyId: request.apiKey.keyId,
    name: request.apiKey.name,
    prefix: request.apiKey.prefix,
  }),
);
