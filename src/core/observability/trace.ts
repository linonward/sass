import siteConfig from "../../../site.config";

import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

// Without a registered OTel provider (observability.otel off, tests), this returns a no-op
// implementation with negligible overhead.
// Named after the site: in the OTel backend you can tell at a glance which site sent the spans,
// and the template's name doesn't end up in the buyer's traces.
const tracer = () => trace.getTracer(siteConfig.name);

/** Records the error on the span and marks it as failed. */
export function recordSpanError(span: Span, error: unknown) {
  span.recordException(
    error instanceof Error ? error : { message: String(error) },
  );
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Runs fn inside a span; logs written inside fn automatically carry this span's traceId.
 * If fn throws, the exception is recorded, the span is marked failed, and the error is rethrown
 * as-is. The span always ends.
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Starts a span not bound to the active context; the caller is responsible for end() (streaming
 * calls end it in a callback).
 */
export function startSpan(name: string, attributes: Attributes) {
  return tracer().startSpan(name, { attributes });
}

/** Adds attributes to the currently active span, if any. */
export function setSpanAttributes(attributes: Attributes) {
  trace.getActiveSpan()?.setAttributes(attributes);
}
