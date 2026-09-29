// Runs before any frontend code (the Next.js instrumentation-client convention).
// OBSERVABILITY_SENTRY is inlined by next.config.ts at build time; with observability.sentry off, the
// Sentry SDK is left out of the bundle.
type Sentry = typeof import("@/core/observability/sentry.client");

let sentry: Sentry | undefined;

if (process.env.OBSERVABILITY_SENTRY === "true") {
  void import("@/core/observability/sentry.client").then((module) => {
    sentry = module;
  });
}

// Performance tracing for route transitions (transitions before Sentry initializes aren't recorded).
export function onRouterTransitionStart(
  ...args: Parameters<Sentry["captureRouterTransitionStart"]>
) {
  sentry?.captureRouterTransitionStart(...args);
}
