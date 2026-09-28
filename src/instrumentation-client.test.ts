// @vitest-environment node
// instrumentation-client.ts 顶层读 process.env.OBSERVABILITY_SENTRY，加载 SDK 是异步的
// （void import().then()），所以每个用例都 resetModules 后重新 import，
// 把「模块工厂有没有跑」和「跑在什么时机」当作断言对象。
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  loads: [] as string[],
  captureRouterTransitionStart: vi.fn(),
}));

const sentryClientModule = () => ({
  captureRouterTransitionStart: state.captureRouterTransitionStart,
});

type SentryClientModule = ReturnType<typeof sentryClientModule>;

/** SDK 加载成功时记一笔；用例可以换成延迟/失败的工厂。 */
function mockSentryClient(
  factory: () => SentryClientModule | Promise<SentryClientModule> = () => {
    state.loads.push("sentry.client");
    return sentryClientModule();
  },
) {
  vi.doMock("@/core/observability/sentry.client", factory);
}

async function loadClient() {
  vi.resetModules();
  return import("./instrumentation-client");
}

/** 跑完已排队的宏任务（动态 import 的 .then 在宏任务之后才轮到）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  state.loads.length = 0;
  state.captureRouterTransitionStart.mockClear();
  vi.stubEnv("OBSERVABILITY_SENTRY", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/core/observability/sentry.client");
});

describe("instrumentation-client", () => {
  test("OBSERVABILITY_SENTRY 不是 true：不加载 SDK，调用也不炸", async () => {
    mockSentryClient();

    const { onRouterTransitionStart } = await loadClient();
    await flush();

    expect(state.loads).toEqual([]);
    expect(() => onRouterTransitionStart("/pricing", "push")).not.toThrow();
    expect(state.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  test("开关在模块加载时读一次：之后再改 env 也不会补加载", async () => {
    mockSentryClient();

    const { onRouterTransitionStart } = await loadClient();
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    onRouterTransitionStart("/pricing", "push");
    await flush();

    expect(state.loads).toEqual([]);
    expect(state.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  test("OBSERVABILITY_SENTRY=true：异步加载 SDK，就绪后转发路由切换", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    mockSentryClient();

    const { onRouterTransitionStart } = await loadClient();
    await vi.waitFor(() => expect(state.loads).toEqual(["sentry.client"]));

    onRouterTransitionStart("/pricing", "push");

    expect(state.captureRouterTransitionStart).toHaveBeenCalledExactlyOnceWith(
      "/pricing",
      "push",
    );
  });

  test("SDK 还没到位就路由切换：跳过但不抛错，到位后照常转发", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    // 卡住 SDK 的加载，模拟「Sentry 初始化之前的路由切换」。
    const gate = Promise.withResolvers<void>();
    mockSentryClient(async () => {
      await gate.promise;
      state.loads.push("sentry.client");
      return sentryClientModule();
    });

    const { onRouterTransitionStart } = await loadClient();

    expect(state.loads).toEqual([]);
    expect(() => onRouterTransitionStart("/pricing", "push")).not.toThrow();
    expect(state.captureRouterTransitionStart).not.toHaveBeenCalled();

    gate.resolve();
    await vi.waitFor(() => expect(state.loads).toEqual(["sentry.client"]));

    onRouterTransitionStart("/docs", "replace");
    expect(state.captureRouterTransitionStart).toHaveBeenCalledExactlyOnceWith(
      "/docs",
      "replace",
    );
  });
});
