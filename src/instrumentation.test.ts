// @vitest-environment node
// 启动路径：instrumentation.ts 顶层读 site.config，调用时读 process.env，所以每个用例都
// 先 resetModules 再重新 import 一份干净的模块（vi.doMock 换 site.config 替身）。
// 断言的是「该不该加载、加载了哪一个模块」——@vercel/otel / Sentry 都 mock 成空实现，不真初始化。
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const logged = vi.hoisted(() => {
  // 模块工厂被执行的顺序即加载顺序（OTel 在 Sentry 之前，见 register() 里的注释）。
  const loaded: string[] = [];
  return {
    loaded,
    registerOTel: vi.fn(() => {
      loaded.push("otel");
    }),
    captureRequestError: vi.fn(),
    warnIfRateLimitUnconfigured: vi.fn(),
    loggerError: vi.fn(),
  };
});

// 这些 mock 在 load() 里按用例重新注册：vi.mock 的工厂结果会被缓存，resetModules 之后
// 也不会重跑，而「某个模块有没有被 import」正是这里要断言的东西。
vi.mock("@/core/observability/logger", () => ({
  logger: {
    error: logged.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

type SiteStub = {
  name: string;
  features: { observability: boolean };
  observability: { otel: boolean };
};

const site: SiteStub = {
  name: "Instrumentation Test",
  features: { observability: true },
  observability: { otel: false },
};

/** 每个用例重新 import 一份干净的模块：顶层读过 site.config，调用时读 process.env。 */
async function load(overrides: Partial<SiteStub> = {}) {
  vi.resetModules();
  vi.doMock("../site.config", () => ({ default: { ...site, ...overrides } }));
  vi.doMock("@vercel/otel", () => ({ registerOTel: logged.registerOTel }));
  vi.doMock("@sentry/nextjs", () => {
    logged.loaded.push("@sentry/nextjs");
    return { captureRequestError: logged.captureRequestError };
  });
  vi.doMock("@/core/observability/sentry.server", () => {
    logged.loaded.push("sentry.server");
    return {};
  });
  vi.doMock("@/core/observability/sentry.edge", () => {
    logged.loaded.push("sentry.edge");
    return {};
  });
  vi.doMock("@/core/ratelimit/startup", () => ({
    warnIfRateLimitUnconfigured: logged.warnIfRateLimitUnconfigured,
  }));
  return import("./instrumentation");
}

const mocks = [
  logged.registerOTel,
  logged.captureRequestError,
  logged.warnIfRateLimitUnconfigured,
  logged.loggerError,
];

beforeEach(() => {
  for (const mock of mocks) mock.mockClear();
  logged.loaded.length = 0;
  // Next.js 在两种 runtime 各调一次 register()，用 NEXT_RUNTIME 区分。
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("OBSERVABILITY_SENTRY", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of [
    "../site.config",
    "@vercel/otel",
    "@sentry/nextjs",
    "@/core/observability/sentry.server",
    "@/core/observability/sentry.edge",
    "@/core/ratelimit/startup",
  ]) {
    vi.doUnmock(path);
  }
});

describe("register", () => {
  test("otel 开着：用站点名注册 OTel，然后才加载 Sentry（Node runtime）", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load({ observability: { otel: true } });

    await register();

    expect(logged.registerOTel).toHaveBeenCalledExactlyOnceWith({
      serviceName: "Instrumentation Test",
    });
    // 顺序也是断言的一部分：同时开启时 Sentry 要沿用已注册的 tracer provider。
    expect(logged.loaded).toEqual(["otel", "sentry.server"]);
    expect(logged.warnIfRateLimitUnconfigured).toHaveBeenCalledOnce();
  });

  test("otel 关着：不碰 @vercel/otel，只加载 Sentry", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.registerOTel).not.toHaveBeenCalled();
    expect(logged.loaded).toEqual(["sentry.server"]);
  });

  test("features.observability 关着：otel 配了 true 也不注册，Sentry 只看环境变量", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load({
      features: { observability: false },
      observability: { otel: true },
    });

    await register();

    expect(logged.registerOTel).not.toHaveBeenCalled();
    // OBSERVABILITY_SENTRY 是 next.config.ts 按 features.observability 在构建时写死的，
    // 运行时不再重复判断 features —— 关掉时整段连同 SDK 都不在产物里。
    expect(logged.loaded).toEqual(["sentry.server"]);
  });

  test("Sentry 开着但没开 observability 的变量：整个 Sentry 段不加载", async () => {
    const { register } = await load({ observability: { otel: true } });

    await register();

    expect(logged.registerOTel).toHaveBeenCalledOnce();
    expect(logged.loaded).toEqual(["otel"]);
  });

  test("Edge runtime 加载 edge 那一份，不做限流判定", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.loaded).toEqual(["sentry.edge"]);
    // Edge 上的 process.env 不完整，判定会把配好的部署误判成漏配。
    expect(logged.warnIfRateLimitUnconfigured).not.toHaveBeenCalled();
  });

  test("不认识的 runtime：两份 Sentry 都不加载，也不做限流判定", async () => {
    vi.stubEnv("NEXT_RUNTIME", "browser");
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.loaded).toEqual([]);
    expect(logged.warnIfRateLimitUnconfigured).not.toHaveBeenCalled();
  });

  test("缺 NEXT_RUNTIME 时不加载任何 runtime 专属模块", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.loaded).toEqual([]);
    expect(logged.warnIfRateLimitUnconfigured).not.toHaveBeenCalled();
  });
});

const request = {
  path: "/dashboard?token=secret",
  method: "GET",
  headers: { "user-agent": "vitest" },
} as const;

const context = {
  routerKind: "App Router",
  routePath: "/dashboard",
  routeType: "render",
  renderSource: "server-rendering",
  revalidateReason: undefined,
} as const;

describe("onRequestError", () => {
  test("features.observability 关着：既不记日志也不上报，Sentry SDK 都不加载", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { onRequestError } = await load({
      features: { observability: false },
    });

    await onRequestError(new Error("boom"), request, context);

    expect(logged.loggerError).not.toHaveBeenCalled();
    expect(logged.captureRequestError).not.toHaveBeenCalled();
    expect(logged.loaded).not.toContain("@sentry/nextjs");
  });

  test("Sentry 关着：只交给 logger，字段是请求上下文", async () => {
    const { onRequestError } = await load();
    const error = new Error("boom");

    await onRequestError(error, request, context);

    expect(logged.captureRequestError).not.toHaveBeenCalled();
    expect(logged.loaded).not.toContain("@sentry/nextjs");
    expect(logged.loggerError).toHaveBeenCalledOnce();
    expect(logged.loggerError.mock.calls[0]?.[0]).toBe("request.error");
    expect(logged.loggerError.mock.calls[0]?.[1]).toMatchObject({
      error,
      method: "GET",
      path: "/dashboard",
      routePath: "/dashboard",
      routeType: "render",
      renderSource: "server-rendering",
    });
  });

  test("Sentry 开着：先转给 captureRequestError（带请求上下文），再记日志", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { onRequestError } = await load();
    const error = new Error("boom");

    await onRequestError(error, request, context);

    expect(logged.captureRequestError).toHaveBeenCalledExactlyOnceWith(
      error,
      request,
      context,
    );
    expect(logged.loaded).toContain("@sentry/nextjs");
    expect(logged.loggerError).toHaveBeenCalledOnce();
    expect(logged.loggerError.mock.calls[0]?.[0]).toBe("request.error");
  });

  test("path 只记路径：query 里的 token 不进日志", async () => {
    const { onRequestError } = await load();

    for (const [path, expected] of [
      ["/dashboard?token=secret", "/dashboard"],
      ["/dashboard", "/dashboard"],
      // 第二个 ? 之后也算 query（split 取第一段）。
      ["/a?b=1?c=2", "/a"],
      ["/search?q=a%3Fb", "/search"],
    ] as const) {
      logged.loggerError.mockClear();
      await onRequestError(new Error("boom"), { ...request, path }, context);

      const fields = logged.loggerError.mock.calls[0]?.[1];
      expect(fields).toMatchObject({ path: expected });
      expect(JSON.stringify(fields)).not.toContain("secret");
    }
  });
});
