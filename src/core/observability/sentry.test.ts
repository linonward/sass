// @vitest-environment node
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";

import { sessionUserId } from "../auth/identify";
import { createAppEnv } from "../create-env";
import {
  canUploadSourceMaps,
  observabilityClientEnv,
  observabilityServerEnv,
} from "./env";
import { createLogger } from "./logger";
import {
  captureError,
  identifyUser,
  registerSentry,
  reportToSentry,
  sentryBaseOptions,
  type SentryApi,
} from "./sentry";
import { SENTRY_TUNNEL_ROUTE } from "./tunnel";

function fakeSentry() {
  const scope = { setTag: vi.fn(), setUser: vi.fn(), setExtras: vi.fn() };
  const api = {
    captureException: vi.fn(),
    setUser: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => unknown) =>
      callback(scope),
    ),
  };
  registerSentry(api as unknown as SentryApi);
  return { api, scope };
}

afterEach(() => registerSentry(undefined));

describe("reportToSentry", () => {
  test("没注册 SDK 时什么也不做", () => {
    expect(() => reportToSentry(new Error("x"), "x.failed", {})).not.toThrow();
  });

  test("上报错误本身，事件名做 tag，userId 设为用户，其余字段放 extra", () => {
    const { api, scope } = fakeSentry();
    const error = new Error("boom");
    reportToSentry(error, "billing.webhook_failed", {
      error: { message: "boom" },
      userId: "u_1",
      provider: "creem",
    });
    expect(api.captureException).toHaveBeenCalledWith(error);
    expect(scope.setTag).toHaveBeenCalledWith(
      "event",
      "billing.webhook_failed",
    );
    expect(scope.setUser).toHaveBeenCalledWith({ id: "u_1" });
    expect(scope.setExtras).toHaveBeenCalledWith({ provider: "creem" });
  });

  test("没有 Error 时用事件名造一个", () => {
    const { api, scope } = fakeSentry();
    reportToSentry(undefined, "ai.provider_down", { model: "fast" });
    const captured = api.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("ai.provider_down");
    expect(scope.setUser).not.toHaveBeenCalled();
  });

  test("接在 logger 上：logger.error 上报，字段已脱敏", () => {
    const { api, scope } = fakeSentry();
    const logger = createLogger({ level: "error", format: "json", write() {} });
    logger.setErrorReporter(reportToSentry);
    const error = new Error("send failed");
    logger.error("auth.sign_in_code_failed", { error, email: "a@b.com" });
    logger.warn("only.warn", { error });
    expect(api.captureException).toHaveBeenCalledOnce();
    expect(api.captureException).toHaveBeenCalledWith(error);
    expect(scope.setExtras).toHaveBeenCalledWith({ email: "[redacted]" });
  });
});

describe("identifyUser / captureError", () => {
  test("只发用户 ID；退出登录时清空", () => {
    const { api } = fakeSentry();
    identifyUser("u_1");
    identifyUser(null);
    expect(api.setUser.mock.calls).toEqual([[{ id: "u_1" }], [null]]);
  });

  test("captureError 转给 SDK；没注册时静默", () => {
    expect(() => captureError(new Error("x"))).not.toThrow();
    const { api } = fakeSentry();
    const error = new Error("render");
    captureError(error);
    expect(api.captureException).toHaveBeenCalledWith(error);
  });

  test("初始化参数不收集 cookie、IP、query、请求体和局部变量", () => {
    const options = sentryBaseOptions({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "production",
    });
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "production",
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        genAI: { inputs: false, outputs: false },
      },
    });
  });

  test("浏览器里 SDK 加载前设置的用户，注册时补上", () => {
    vi.stubGlobal("window", {});
    try {
      identifyUser("u_early");
      const { api } = fakeSentry();
      expect(api.setUser).toHaveBeenCalledWith({ id: "u_early" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("服务端 SDK 未注册时不暂存用户（避免串到别的请求）", () => {
    identifyUser("u_server");
    const { api } = fakeSentry();
    expect(api.setUser).not.toHaveBeenCalled();
  });
});

describe("sessionUserId", () => {
  test.each([
    [{ user: { id: "u_1" }, session: {} }, "u_1"],
    [null, null],
    [undefined, null],
    [{ user: null }, null],
    [new Response(null), null],
  ])("%o → %o", (returned, expected) => {
    expect(sessionUserId(returned)).toBe(expected);
  });
});

describe("Sentry 变量", () => {
  const env = (sentry: boolean, runtimeEnv: Record<string, string>) =>
    createAppEnv({
      server: observabilityServerEnv(),
      client: observabilityClientEnv({ sentry }),
      runtimeEnv,
    });

  test("关闭时不要求任何变量", () => {
    expect(() => env(false, {})).not.toThrow();
  });

  test("开启时必须填 DSN，source map 相关变量可选", () => {
    expect(() => env(true, {})).toThrow("- NEXT_PUBLIC_SENTRY_DSN: ");
    expect(() => env(true, { NEXT_PUBLIC_SENTRY_DSN: "not a url" })).toThrow(
      "- NEXT_PUBLIC_SENTRY_DSN: ",
    );
    expect(
      env(true, { NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" })
        .NEXT_PUBLIC_SENTRY_DSN,
    ).toBe("https://k@o1.ingest.sentry.io/1");
  });

  test("三项都填了才上传 source map", () => {
    const all = {
      SENTRY_AUTH_TOKEN: "t",
      SENTRY_ORG: "o",
      SENTRY_PROJECT: "p",
    };
    expect(canUploadSourceMaps(all)).toBe(true);
    expect(canUploadSourceMaps({ ...all, SENTRY_PROJECT: "" })).toBe(false);
    expect(canUploadSourceMaps({})).toBe(false);
  });
});

test("proxy 的 matcher 跳过 Sentry 转发路径", () => {
  // matcher 只能写字面量，这里防止两边改漏。
  const source = readFileSync(
    new URL("../../proxy.ts", import.meta.url),
    "utf8",
  );
  const matcher = /matcher: "(.+)"/.exec(source)?.[1] ?? "";
  expect(matcher).toContain(`|${SENTRY_TUNNEL_ROUTE.slice(1)}|`);
});
