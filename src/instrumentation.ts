import type { Instrumentation } from "next";

import { logger } from "@/core/observability/logger";

import siteConfig from "../site.config";

const { features, observability } = siteConfig;

// Next.js calls this once at server startup (once per runtime, Node and Edge).
export async function register() {
  if (features.observability && observability.otel) {
    // On Vercel, traces go to Vercel's collector (enable the Tracing / OTel integration in the
    // project); elsewhere they're exported to OTEL_EXPORTER_OTLP_ENDPOINT if set, and not at all if not.
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: siteConfig.name });
  }
  // After OTel: with both on, Sentry reuses the tracer provider already registered.
  // OBSERVABILITY_SENTRY is inlined by next.config.ts at build time; when off, this whole block and
  // the SDK are left out of the bundle.
  if (process.env.OBSERVABILITY_SENTRY === "true") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("@/core/observability/sentry.server");
    } else if (process.env.NEXT_RUNTIME === "edge") {
      await import("@/core/observability/sentry.edge");
    }
  }
  // If Upstash is missing for rate limiting, say so clearly in the startup log (at runtime in
  // production, AI / upload / checkout requests will be rejected). Check only in the Node runtime:
  // process.env on Edge is incomplete and would flag a correctly configured deployment.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfRateLimitUnconfigured } =
      await import("@/core/ratelimit/startup");
    warnIfRateLimitUnconfigured();
  }
}

// Uncaught request errors (page rendering, route handlers, Server Actions, proxy).
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (!features.observability) return;
  if (process.env.OBSERVABILITY_SENTRY === "true") {
    // Hand it to Sentry first (with request context); Sentry takes a given error object only once, so
    // the report from logger.error below is skipped.
    const { captureRequestError } = await import("@sentry/nextjs");
    captureRequestError(error, request, context);
  }
  logger.error("request.error", {
    error,
    method: request.method,
    // Log the path only, not the query: it may contain params like tokens.
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
