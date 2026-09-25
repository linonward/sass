import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

// 没有注册 OTel（observability.otel 关闭、测试环境）时，这里拿到的是空实现，开销可以忽略。
const tracer = () => trace.getTracer("sass");

/** 把错误记到 span 上并标记失败。 */
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
 * 在一个 span 里执行 fn，fn 内部的日志自动带上这个 span 的 traceId。
 * fn 抛错时记录异常、标记失败后原样抛出；span 总会结束。
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

/** 开一个不绑定上下文的 span，由调用方负责 end()（流式调用在回调里结束）。 */
export function startSpan(name: string, attributes: Attributes) {
  return tracer().startSpan(name, { attributes });
}

/** 给当前活动的 span（如果有）补充属性。 */
export function setSpanAttributes(attributes: Attributes) {
  trace.getActiveSpan()?.setAttributes(attributes);
}
