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
  // 放在 OTel 之后：同时开启时 Sentry 沿用已注册的 tracer provider。
  // OBSERVABILITY_SENTRY 由 next.config.ts 在构建时写死，关闭时整段连同 SDK 都不会打进产物。
  if (process.env.OBSERVABILITY_SENTRY === "true") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("@/core/observability/sentry.server");
    } else if (process.env.NEXT_RUNTIME === "edge") {
      await import("@/core/observability/sentry.edge");
    }
  }
}

// 未捕获的请求错误（页面渲染、路由处理、Server Action、proxy）。
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (!features.observability) return;
  if (process.env.OBSERVABILITY_SENTRY === "true") {
    // 先交给 Sentry（带请求上下文）；同一个错误对象 Sentry 只收一次，下面 logger.error 的上报会被跳过。
    const { captureRequestError } = await import("@sentry/nextjs");
    captureRequestError(error, request, context);
  }
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
