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

describe("json 格式", () => {
  test("单行 JSON：level、event、time 和字段", () => {
    const { logger, write, lines } = setup();
    logger.info("ai.usage", { modelId: "deepseek", credits: 1 });
    expect(write).toHaveBeenCalledWith("info", expect.any(String));
    expect(write.mock.calls[0][1]).not.toContain("\n");
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

  test("带上当前 span 的 traceId 和 spanId", () => {
    const { logger, lines } = setup({
      traceContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
    });
    logger.info("billing.webhook");
    expect(lines()[0]).toMatchObject({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });
  });

  test("低于级别的日志不输出", () => {
    const { logger, write } = setup({ level: "warn" });
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(write.mock.calls.map(([level]) => level)).toEqual(["warn", "error"]);
  });

  test("Error 序列化出 name、message、stack 和 cause", () => {
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

  test("字段对象里的 Error 同样序列化", () => {
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

describe("脱敏", () => {
  test("邮箱、token、密码、cookie 等字段替换为 [redacted]，嵌套和数组也处理", () => {
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

  test("输出的日志里没有敏感值", () => {
    const { logger, write } = setup();
    logger.error("auth.failed", { email: "a@b.com", token: "secret-token" });
    const line = write.mock.calls[0][1] as string;
    expect(line).not.toContain("a@b.com");
    expect(line).not.toContain("secret-token");
  });
});

describe("pretty 格式", () => {
  test("事件名、字段和原始 Error 交给 console", () => {
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

  test("没有字段时只输出事件名", () => {
    const { logger, write } = setup({ format: "pretty" });
    logger.warn("ratelimit.disabled");
    expect(write).toHaveBeenCalledWith("warn", "[ratelimit.disabled]");
  });
});

describe("错误上报钩子", () => {
  test("logger.error 调用钩子，传入 Error、事件名和脱敏后的字段", () => {
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

  test("级别过滤掉的 error 也会上报", () => {
    const { logger, write } = setup({ level: "error" });
    const reporter = vi.fn();
    logger.setErrorReporter(reporter);
    logger.error("x");
    expect(reporter).toHaveBeenCalledWith(undefined, "x", {});
    expect(write).toHaveBeenCalledOnce();
  });

  test("钩子报错不影响调用方，取消注册后不再调用", () => {
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
    },
    observability,
  });

  test("关闭 features.observability：保持原来的 console 输出，只打 warn 以上", () => {
    expect(loggerOptionsFromConfig(config(false), "production")).toEqual({
      level: "warn",
      format: "pretty",
    });
  });

  test("开启后生产环境输出 JSON，级别取配置", () => {
    expect(loggerOptionsFromConfig(config(true), "production")).toEqual({
      level: "debug",
      format: "json",
    });
    expect(loggerOptionsFromConfig(config(true), "development")).toEqual({
      level: "debug",
      format: "pretty",
    });
  });

  test("测试环境只打 warn 以上", () => {
    expect(loggerOptionsFromConfig(config(true), "test")).toEqual({
      level: "warn",
      format: "pretty",
    });
  });
});
