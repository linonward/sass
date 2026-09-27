import { logger, type LogFn } from "@/core/observability/logger";

import {
  allowUnratelimited,
  isSelfHostedProduction,
  missingRedisPolicy,
  upstashConfigured,
} from "./env";
import { rateLimitingEnabled } from "./features";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * 服务启动时检查限流配置，生产运行时不配 Redis 就打一条显眼的 error 日志
 * （`ratelimit.unconfigured`）：这是自托管部署最容易漏的一步，漏了之后 AI / 上传 /
 * 结账都会返回 503，只从 5xx 反推原因太绕。`ALLOW_UNRATELIMITED` 显式放行时降为 warn ——
 * 限流确实是关着的，但那是操作者自己的选择。
 *
 * 放在 `instrumentation.ts` 的 `register()` 里调用（只在 Node runtime：Edge 上的
 * `process.env` 不完整，判定会失真）。
 *
 * 故意不抛错中断启动：限流只挡 AI / 上传 / 结账这几个接口，为它们让整个站点（营销页、
 * 登录）起不来不划算，这些接口自己会返回 503，日志说明原因。
 */
export function warnIfRateLimitUnconfigured({
  runtimeEnv = process.env,
  log = logger,
}: {
  runtimeEnv?: RuntimeEnv;
  log?: { warn: LogFn; error: LogFn };
} = {}) {
  if (!rateLimitingEnabled() || upstashConfigured(runtimeEnv)) return;

  const missing = "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set";
  const fix =
    "set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set ALLOW_UNRATELIMITED=1 to run without rate limiting";

  if (missingRedisPolicy(runtimeEnv, { enabled: true }) === "unavailable") {
    log.error("ratelimit.unconfigured", {
      reason: missing,
      effect:
        "AI, upload and checkout endpoints return 503 until Redis is configured",
      fix,
    });
    return;
  }

  // 生产运行时里显式设了 ALLOW_UNRATELIMITED：放行是有意的，但限流确实没在跑。
  if (isSelfHostedProduction(runtimeEnv) && allowUnratelimited(runtimeEnv)) {
    log.warn("ratelimit.disabled", { reason: "ALLOW_UNRATELIMITED is set" });
  }
}
