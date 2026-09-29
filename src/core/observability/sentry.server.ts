import * as Sentry from "@sentry/nextjs";

import siteConfig from "../../../site.config";
import { registerSentry, sentryBaseOptions } from "./sentry";

// Sentry initialization for the Node runtime, loaded dynamically by instrumentation.ts when
// observability.sentry is on.
const { observability } = siteConfig;

Sentry.init({
  ...sentryBaseOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  }),
  ...(observability.otel
    ? {
        // @vercel/otel has already registered a tracer provider, so Sentry doesn't register a
        // second one. Tracing stays in OTel; Sentry only collects errors and links them to the
        // current OTel span. Sampling is decided on the OTel side.
        enableOpenTelemetrySetup: false,
        integrations: [Sentry.openTelemetryIntegration()],
      }
    : { tracesSampleRate: observability.sentryTracesSampleRate }),
});

registerSentry(Sentry);
