import type { Instrumentation } from "next";

import { logger } from "@/core/observability/logger";

import siteConfig from "../site.config";

const { features, observability } = siteConfig;

// Next.js 在服务启动时调用一次（Node 和 Edge 两种 runtime 各一次）。
export async function register() {
  if (features.observability && observability.otel) {
    // 在 Vercel 上走 Vercel 的 trace 收集（需要在项目里开启 Tracing / OTel 集成）；
    // 其他环境配了 OTEL_EXPORTER_OTLP_ENDPOINT 就导出到那里，没配不导出。
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: siteConfig.name });
  }
}

// 未捕获的请求错误（页面渲染、路由处理、Server Action、proxy）。
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  if (!features.observability) return;
  logger.error("request.error", {
    error,
    method: request.method,
    // 只记路径，不记 query：里面可能有 token 之类的参数。
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
