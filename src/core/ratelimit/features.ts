import siteConfig from "../../../site.config";

/**
 * 限流是否在用：`features.rateLimit` 本身，或任何会调用限流的模块
 * （AI、上传、留资、API Key 的 per-key 限制）。
 *
 * `src/core/env.ts`（决定要不要强制要求 Upstash 变量）、限流的接线和启动检查都用它，
 * 免得这几处的判断漂移 —— 落下一处就会出现「变量按开了要，运行时却按没开处理」。
 */
export function rateLimitingEnabled() {
  const { features, acquisition, apiKeys } = siteConfig;
  return (
    features.rateLimit ||
    features.ai ||
    features.upload ||
    acquisition.leads.enabled ||
    // 配了 per-key 阈值就是真的在限流，同样需要 Upstash 变量。
    apiKeys.rateLimitPerKey !== undefined
  );
}
