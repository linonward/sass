import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// Browser-side Sentry initialization, loaded dynamically by instrumentation-client.ts when
// observability.sentry is on. Session Replay and the user feedback widget stay off.
Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  tracesSampleRate: siteConfig.observability.sentryTracesSampleRate,
});

registerSentry(Sentry);

export const captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
