import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// Sentry initialization for the Edge runtime (proxy.ts and others), loaded dynamically by
// instrumentation.ts when observability.sentry is on.
Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  tracesSampleRate: siteConfig.observability.sentryTracesSampleRate,
});

registerSentry(Sentry);
