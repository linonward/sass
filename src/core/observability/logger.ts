import { isSpanContextValid, trace } from "@opentelemetry/api";

// Loaded by instrumentation.ts (in both the Node and Edge runtimes), so only use APIs available in
// both.
import siteConfig from "../../../site.config";
import { reportToSentry } from "./sentry";

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];
export type LogFields = Record<string, unknown>;
/** An injectable log function (shaped like logger.error / logger.warn); tests swap in vi.fn(). */
export type LogFn = (event: string, fieldsOrError?: unknown) => void;

/**
 * Error reporting hook. When Sentry is on, it does the reporting. `error` is the first Error found
 * in the fields, or undefined if there is none.
 */
export type ErrorReporter = (
  error: unknown,
  event: string,
  fields: LogFields,
) => void;

export type LoggerOptions = {
  level: LogLevel;
  // json: single-line JSON for log platforms to search; pretty: passed to console, easy to read in
  // development.
  format: "json" | "pretty";
  now?: () => Date;
  // Writes to console by default; tests inject their own.
  write?: (level: LogLevel, ...args: unknown[]) => void;
  traceContext?: () => { traceId: string; spanId: string } | undefined;
};

const REDACTED = "[redacted]";
const MAX_DEPTH = 5;

// A field is redacted when its name (ignoring case, `_` and `-`) matches any of these rules:
// 1. It equals a word in SENSITIVE_KEYS.
// 2. It ends with a word in SENSITIVE_SUFFIXES — userEmail, accessToken, userOtp, and so on.
//    Counters like inputTokens are unaffected (they end in "tokens").
// 3. It ends in "code" and the prefix is a credential word (isVerificationCodeKey) —
//    verificationCode, otp_code, pinCode.
//
// `code` is deliberately not a suffix: among names ending in "code", diagnostic fields such as
// statusCode / errorCode / countryCode / zipCode far outnumber verification codes. A blanket
// suffix rule would wipe them all to [redacted], silently degrading observability — during an
// incident nobody notices right away that those values are missing from the logs. So verification
// codes are identified by whether the prefix is a credential word, and a bare `code` is handled
// separately (see the empty string in VERIFICATION_CODE_PREFIXES).
const SENSITIVE_SUFFIXES = [
  "email",
  "token",
  "password",
  "secret",
  "apikey",
  // Verification codes: otp (including hotp / totp) and pin are credentials themselves, so they
  // are sensitive whenever they end a field name.
  "otp",
  "pin",
];
const SENSITIVE_KEYS = new Set(["authorization", "cookie", "setcookie"]);
// `*code` fields with one of these prefixes are redacted as verification codes. The empty string
// stands for a bare `code`: in log fields, `code` almost always shows up in sign-in / verification
// code flows, while error and status codes usually carry a prefix (errorCode, statusCode) and are
// unaffected.
const VERIFICATION_CODE_PREFIXES = new Set([
  "",
  "verification",
  "verify",
  "otp",
  "auth",
  "security",
  "sms",
  "mail",
  "email",
  "pin",
  "totp",
  "mfa",
  "twofactor",
  "2fa",
  "confirm",
  "confirmation",
  "activation",
  "activate",
  "reset",
  "magic",
  "onetime",
  "backup",
  "recovery",
]);

function isVerificationCodeKey(normalized: string) {
  if (!normalized.endsWith("code")) return false;
  return VERIFICATION_CODE_PREFIXES.has(normalized.slice(0, -"code".length));
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    isVerificationCodeKey(normalized)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Turns an Error into a JSON-serializable object, including its cause and the Next.js digest. */
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

/**
 * Recursively replaces sensitive fields. Errors are serialized; other objects are left as-is for
 * JSON.stringify.
 */
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

/**
 * The second argument can be a fields object or the error itself:
 * logger.error("x.failed", error).
 */
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
        // Pass the error object to console as-is to keep stack highlighting in the terminal.
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
    /**
     * Error log, and the only entry point for error reporting. The second argument can be an Error
     * or a fields object (with the Error in any field).
     */
    error: (event: string, fieldsOrError?: LogFields | unknown) =>
      log("error", event, fieldsOrError),
    /**
     * Registers the error reporter (only one at a time); returns a function that unregisters it.
     */
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
 * Derives logging behavior from site.config.ts:
 * - features.observability off: plain console output as before, only warn and error.
 * - On: the level comes from observability.logLevel; production writes single-line JSON (with
 *   traceId).
 * - Tests only log warn and above, to keep output quiet.
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

/** The logger instance used throughout src/core. */
export const logger = createLogger(loggerOptionsFromConfig(siteConfig));

// logger.error also reports to Sentry. When Sentry is off, no SDK is registered and this does
// nothing.
logger.setErrorReporter(reportToSentry);
