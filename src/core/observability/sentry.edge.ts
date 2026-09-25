import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// Edge runtime（proxy.ts 等）的 Sentry 初始化，由 instrumentation.ts 在开启 observability.sentry 时动态加载。
Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  tracesSampleRate: siteConfig.observability.sentryTracesSampleRate,
});

registerSentry(Sentry);
