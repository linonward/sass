import { describe, expect, test, vi } from "vitest";

import {
  createLogger,
  loggerOptionsFromConfig,
  redact,
  type LoggerOptions,
} from "./logger";

const time = new Date("2026-09-26T08:00:00.000Z");

function setup(options: Partial<LoggerOptions> = {}) {
  const write = vi.fn();
  const logger = createLogger({
    level: "info",
    format: "json",
    now: () => time,
    write,
    traceContext: () => undefined,
    ...options,
  });
  const lines = () =>
    write.mock.calls.map(([, line]) => JSON.parse(line as string));
  return { logger, write, lines };
}

describe("json format", () => {
  test("single-line JSON with level, event, time, and fields", () => {
    const { logger, write, lines } = setup();
    logger.info("ai.usage", { modelId: "deepseek", credits: 1 });
    expect(write).toHaveBeenCalledWith("info", expect.any(String));
    expect(write.mock.calls[0]![1]).not.toContain("\n");
    expect(lines()).toEqual([
      {
        level: "info",
        event: "ai.usage",
        time: "2026-09-26T08:00:00.000Z",
        modelId: "deepseek",
        credits: 1,
      },
    ]);
  });

  test("includes the current span's traceId and spanId", () => {
    const { logger, lines } = setup({
      traceContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
    });
    logger.info("billing.webhook");
    expect(lines()[0]).toMatchObject({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });
  });

  test("drops logs below the level", () => {
    const { logger, write } = setup({ level: "warn" });
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(write.mock.calls.map(([level]) => level)).toEqual(["warn", "error"]);
  });

  test("serializes an Error with name, message, stack, and cause", () => {
    const { logger, lines } = setup();
    const cause = new Error("socket hang up");
    const error = Object.assign(new TypeError("fetch failed", { cause }), {
      digest: "123",
    });
    logger.error("ai.model_failed", error);
    const { error: logged } = lines()[0];
    expect(logged).toMatchObject({
      name: "TypeError",
      message: "fetch failed",
      digest: "123",
      cause: { name: "Error", message: "socket hang up" },
    });
    expect(logged.stack).toContain("TypeError: fetch failed");
  });

  test("serializes an Error inside a fields object too", () => {
    const { logger, lines } = setup();
    logger.error("ai.model_failed", {
      error: new Error("boom"),
      modelId: "qwen",
    });
    expect(lines()[0]).toMatchObject({
      error: { message: "boom" },
      modelId: "qwen",
    });
  });
});

describe("redaction", () => {
  test("replaces email, token, password, cookie, and similar fields with [redacted], including nested objects and arrays", () => {
    expect(
      redact({
        userId: "u1",
        email: "a@b.com",
        userEmail: "a@b.com",
        accessToken: "t",
        api_key: "k",
        password: "p",
        clientSecret: "s",
        headers: { Authorization: "Bearer x", cookie: "c", "set-cookie": "c" },
        list: [{ token: "t", ok: 1 }],
        inputTokens: 12,
      }),
    ).toEqual({
      userId: "u1",
      email: "[redacted]",
      userEmail: "[redacted]",
      accessToken: "[redacted]",
      api_key: "[redacted]",
      password: "[redacted]",
      clientSecret: "[redacted]",
      headers: {
        Authorization: "[redacted]",
        cookie: "[redacted]",
        "set-cookie": "[redacted]",
      },
      list: [{ token: "[redacted]", ok: 1 }],
      inputTokens: 12,
    });
  });

  test("leaves no sensitive values in the written log", () => {
    const { logger, write } = setup();
    logger.error("auth.failed", { email: "a@b.com", token: "secret-token" });
    const line = write.mock.calls[0]![1] as string;
    expect(line).not.toContain("a@b.com");
    expect(line).not.toContain("secret-token");
  });

  test("redacts verification code fields: code, otp, pin, and their variants", () => {
    expect(
      redact({
        code: "123456",
        otp: "123456",
        userOtp: "123456",
        hotp: "123456",
        pin: "4821",
        userPin: "4821",
        pinCode: "4821",
        verificationCode: "123456",
        verification_code: "123456",
        otpCode: "123456",
        smsCode: "123456",
        authCode: "123456",
        securityCode: "123456",
        magicCode: "123456",
        // Nested objects and arrays are handled the same way.
        payload: { code: "123456" },
        attempts: [{ code: "123456", ok: 1 }],
      }),
    ).toEqual({
      code: "[redacted]",
      otp: "[redacted]",
      userOtp: "[redacted]",
      hotp: "[redacted]",
      pin: "[redacted]",
      userPin: "[redacted]",
      pinCode: "[redacted]",
      verificationCode: "[redacted]",
      verification_code: "[redacted]",
      otpCode: "[redacted]",
      smsCode: "[redacted]",
      authCode: "[redacted]",
      securityCode: "[redacted]",
      magicCode: "[redacted]",
      payload: { code: "[redacted]" },
      attempts: [{ code: "[redacted]", ok: 1 }],
    });
  });

  // The other direction: redacting `code` must not wipe out every field named *code.
  // statusCode / errorCode are diagnostic values needed for troubleshooting; redacting them would
  // silently degrade observability.
  test("does not redact diagnostic codes: statusCode, errorCode, countryCode, zipCode", () => {
    expect(
      redact({
        statusCode: 404,
        errorCode: "ECONNREFUSED",
        countryCode: "CN",
        zipCode: "100000",
        httpStatusCode: 500,
        exitCode: 1,
        currencyCode: "USD",
        discountCode: "SPRING",
      }),
    ).toEqual({
      statusCode: 404,
      errorCode: "ECONNREFUSED",
      countryCode: "CN",
      zipCode: "100000",
      httpStatusCode: 500,
      exitCode: 1,
      currencyCode: "USD",
      discountCode: "SPRING",
    });
  });

  test('logger.info("otp", { code }) leaves no verification code in the output', () => {
    const { logger, write, lines } = setup();
    logger.info("otp", { code: "123456" });
    expect(lines()[0]).toMatchObject({ event: "otp", code: "[redacted]" });
    expect(write.mock.calls[0]![1]).not.toContain("123456");
  });
});

describe("pretty format", () => {
  test("passes the event name, fields, and original Error to console", () => {
    const { logger, write } = setup({ format: "pretty" });
    const error = new Error("boom");
    logger.error("ai.model_failed", { error, modelId: "qwen", email: "x@y" });
    expect(write).toHaveBeenCalledWith(
      "error",
      "[ai.model_failed]",
      { modelId: "qwen", email: "[redacted]" },
      error,
    );
  });

  test("writes only the event name when there are no fields", () => {
    const { logger, write } = setup({ format: "pretty" });
    logger.warn("ratelimit.disabled");
    expect(write).toHaveBeenCalledWith("warn", "[ratelimit.disabled]");
  });
});

describe("error reporting hook", () => {
  test("logger.error calls the hook with the Error, event name, and redacted fields", () => {
    const { logger } = setup();
    const reporter = vi.fn();
    logger.setErrorReporter(reporter);
    const error = new Error("boom");
    logger.error("billing.webhook_failed", { error, email: "a@b.com" });
    logger.warn("not.reported");
    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter).toHaveBeenCalledWith(error, "billing.webhook_failed", {
      error: expect.objectContaining({ message: "boom" }),
      email: "[redacted]",
    });
  });

  test("reports errors even when the level filters them out", () => {
    const { logger, write } = setup({ level: "error" });
    const reporter = vi.fn();
    logger.setErrorReporter(reporter);
    logger.error("x");
    expect(reporter).toHaveBeenCalledWith(undefined, "x", {});
    expect(write).toHaveBeenCalledOnce();
  });

  test("a failing hook doesn't affect the caller, and is no longer called after unregistering", () => {
    const { logger, write } = setup();
    const unregister = logger.setErrorReporter(() => {
      throw new Error("sentry down");
    });
    expect(() => logger.error("x")).not.toThrow();
    expect(write).toHaveBeenLastCalledWith(
      "error",
      "[observability] error reporter failed",
      expect.any(Error),
    );
    unregister();
    write.mockClear();
    logger.error("y");
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("loggerOptionsFromConfig", () => {
  const observability = {
    logLevel: "debug" as const,
    otel: false,
    sentry: false,
    sentryTracesSampleRate: 0.1,
    analytics: false,
    speedInsights: false,
  };
  const config = (enabled: boolean) => ({
    features: {
      credits: false,
      ai: false,
      blog: false,
      upload: false,
      admin: false,
      rateLimit: false,
      observability: enabled,
      examples: { invoices: false },
    },
    observability,
  });

  test("features.observability off: keeps plain console output, warn and above only", () => {
    expect(loggerOptionsFromConfig(config(false), "production")).toEqual({
      level: "warn",
      format: "pretty",
    });
  });

  test("when on, production writes JSON and the level comes from config", () => {
    expect(loggerOptionsFromConfig(config(true), "production")).toEqual({
      level: "debug",
      format: "json",
    });
    expect(loggerOptionsFromConfig(config(true), "development")).toEqual({
      level: "debug",
      format: "pretty",
    });
  });

  test("tests log warn and above only", () => {
    expect(loggerOptionsFromConfig(config(true), "test")).toEqual({
      level: "warn",
      format: "pretty",
    });
  });
});
