import { isSpanContextValid, trace } from "@opentelemetry/api";

// 会被 instrumentation.ts 加载（Node 和 Edge 两种 runtime），这里只用两边都有的 API。
import siteConfig from "../../../site.config";

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];
export type LogFields = Record<string, unknown>;
/** 可注入的日志函数（logger.error / logger.warn 的形状），测试里换成 vi.fn()。 */
export type LogFn = (event: string, fieldsOrError?: unknown) => void;

/** 错误上报钩子（T602 用它接 Sentry）。`error` 是字段里的第一个 Error，没有时为 undefined。 */
export type ErrorReporter = (
  error: unknown,
  event: string,
  fields: LogFields,
) => void;

export type LoggerOptions = {
  level: LogLevel;
  // json：单行 JSON，给日志平台检索；pretty：交给 console，开发时易读。
  format: "json" | "pretty";
  now?: () => Date;
  // 默认输出到 console；测试注入。
  write?: (level: LogLevel, ...args: unknown[]) => void;
  traceContext?: () => { traceId: string; spanId: string } | undefined;
};

const REDACTED = "[redacted]";
const MAX_DEPTH = 5;

// 字段名（忽略大小写和 _ -）等于或以这些词结尾时脱敏：email、userEmail、accessToken、apiKey……
// inputTokens 这类计数不受影响（以 tokens 结尾）。
const SENSITIVE_SUFFIXES = ["email", "token", "password", "secret", "apikey"];
const SENSITIVE_KEYS = new Set(["authorization", "cookie", "setcookie"]);

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Error 转成可以 JSON 序列化的对象，带上 cause 和 Next.js 的 digest。 */
export function serializeError(error: Error, depth = 0): LogFields {
  const serialized: LogFields = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if ("digest" in error && error.digest !== undefined) {
    serialized.digest = String(error.digest);
  }
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    serialized.cause =
      error.cause instanceof Error
        ? serializeError(error.cause, depth + 1)
        : redact(error.cause, depth + 1);
  }
  return serialized;
}

/** 递归替换敏感字段；Error 序列化，其他对象保持原样交给 JSON.stringify。 */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value, depth);
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redact(item, depth + 1),
    ]),
  );
}

function defaultWrite(level: LogLevel, ...args: unknown[]) {
  const method =
    level === "error" ? "error" : level === "warn" ? "warn" : "info";
  console[method](...args);
}

function activeTraceContext() {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return undefined;
  return { traceId: context.traceId, spanId: context.spanId };
}

/** 第二个参数可以是字段对象，也可以直接是错误：logger.error("x.failed", error)。 */
function toFields(fieldsOrError: unknown): LogFields {
  if (fieldsOrError === undefined) return {};
  return isPlainObject(fieldsOrError)
    ? fieldsOrError
    : { error: fieldsOrError };
}

function firstError(fields: LogFields) {
  return Object.values(fields).find((value) => value instanceof Error);
}

export function createLogger({
  level,
  format,
  now = () => new Date(),
  write = defaultWrite,
  traceContext = activeTraceContext,
}: LoggerOptions) {
  const threshold = logLevels.indexOf(level);
  let reporter: ErrorReporter | undefined;

  function log(logLevel: LogLevel, event: string, fieldsOrError?: unknown) {
    const raw = toFields(fieldsOrError);
    if (logLevels.indexOf(logLevel) >= threshold) {
      const fields = redact(raw) as LogFields;
      if (format === "json") {
        write(
          logLevel,
          JSON.stringify({
            level: logLevel,
            event,
            time: now().toISOString(),
            ...traceContext(),
            ...fields,
          }),
        );
      } else {
        // 错误对象原样交给 console，保留终端里的堆栈高亮。
        const error = firstError(raw);
        const rest = Object.fromEntries(
          Object.entries(fields).filter(
            ([key]) => error === undefined || raw[key] !== error,
          ),
        );
        write(
          logLevel,
          `[${event}]`,
          ...(Object.keys(rest).length > 0 ? [rest] : []),
          ...(error ? [error] : []),
        );
      }
    }
    if (logLevel === "error" && reporter) {
      try {
        reporter(firstError(raw), event, redact(raw) as LogFields);
      } catch (error) {
        write("error", "[observability] error reporter failed", error);
      }
    }
  }

  return {
    debug: (event: string, fields?: LogFields) => log("debug", event, fields),
    info: (event: string, fields?: LogFields) => log("info", event, fields),
    warn: (event: string, fieldsOrError?: LogFields | unknown) =>
      log("warn", event, fieldsOrError),
    /** 错误日志，也是错误上报的唯一入口。第二个参数可以是 Error 或字段对象（Error 放在任意字段里）。 */
    error: (event: string, fieldsOrError?: LogFields | unknown) =>
      log("error", event, fieldsOrError),
    /** 注册错误上报（同时只有一个）；返回取消注册的函数。 */
    setErrorReporter(next: ErrorReporter | undefined) {
      reporter = next;
      return () => {
        if (reporter === next) reporter = undefined;
      };
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * 按 site.config.ts 决定日志行为：
 * - 关闭 features.observability：与之前的 console 输出一致，只打 warn 和 error。
 * - 开启：级别取 observability.logLevel；生产环境输出单行 JSON（带 traceId）。
 * - 测试环境只打 warn 以上，避免刷屏。
 */
export function loggerOptionsFromConfig(
  config: Pick<typeof siteConfig, "features" | "observability">,
  nodeEnv = process.env.NODE_ENV,
): LoggerOptions {
  const enabled = config.features.observability;
  if (nodeEnv === "test" || !enabled)
    return { level: "warn", format: "pretty" };
  return {
    level: config.observability.logLevel,
    format: nodeEnv === "production" ? "json" : "pretty",
  };
}

/** src/core 统一使用的日志实例。 */
export const logger = createLogger(loggerOptionsFromConfig(siteConfig));
