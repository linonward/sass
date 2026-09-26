import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// Node runtime 的 Sentry 初始化，由 instrumentation.ts 在开启 observability.sentry 时动态加载。
const { observability } = siteConfig;

Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  ...(observability.otel
    ? {
        // 已经由 @vercel/otel 注册了 tracer provider：Sentry 不再注册第二个，追踪留在 OTel 里，
        // Sentry 只收错误，并关联到当前 OTel span。采样由 OTel 那边决定。
        enableOpenTelemetrySetup: false,
        integrations: [Sentry.openTelemetryIntegration()],
      }
    : { tracesSampleRate: observability.sentryTracesSampleRate }),
});

registerSentry(Sentry);
