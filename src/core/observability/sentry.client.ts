import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// 浏览器端的 Sentry 初始化，由 instrumentation-client.ts 在开启 observability.sentry 时动态加载。
// 不开 Session Replay 和用户反馈组件。
Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  tracesSampleRate: siteConfig.observability.sentryTracesSampleRate,
});

registerSentry(Sentry);

export const captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
