// 在前端代码执行前运行（Next.js instrumentation-client 约定）。
// OBSERVABILITY_SENTRY 由 next.config.ts 在构建时写死；关闭 observability.sentry 时 Sentry SDK 不会打进产物。
type Sentry = typeof import("@/core/observability/sentry.client");

let sentry: Sentry | undefined;

if (process.env.OBSERVABILITY_SENTRY === "true") {
  void import("@/core/observability/sentry.client").then((module) => {
    sentry = module;
  });
}

// 路由切换的性能追踪（Sentry 初始化之前的切换不记录）。
export function onRouterTransitionStart(
  ...args: Parameters<Sentry["captureRouterTransitionStart"]>
) {
  sentry?.captureRouterTransitionStart(...args);
}
