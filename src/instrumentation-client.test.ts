// @vitest-environment node
// instrumentation-client.ts reads process.env.OBSERVABILITY_SENTRY at the top level and loads the
// SDK asynchronously (void import().then()), so every test does resetModules and re-imports, and
// asserts on whether the module factory ran and when.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  loads: [] as string[],
  captureRouterTransitionStart: vi.fn(),
}));

const sentryClientModule = () => ({
  captureRouterTransitionStart: state.captureRouterTransitionStart,
});

type SentryClientModule = ReturnType<typeof sentryClientModule>;

/** Records an entry when the SDK loads; tests can swap in a delayed or failing factory. */
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

/** Flush queued macrotasks (a dynamic import's .then only runs after the macrotask). */
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
  test("OBSERVABILITY_SENTRY isn't true: the SDK isn't loaded and calls don't blow up", async () => {
    mockSentryClient();

    const { onRouterTransitionStart } = await loadClient();
    await flush();

    expect(state.loads).toEqual([]);
    expect(() => onRouterTransitionStart("/pricing", "push")).not.toThrow();
    expect(state.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  test("the flag is read once at module load: changing env later doesn't load it after the fact", async () => {
    mockSentryClient();

    const { onRouterTransitionStart } = await loadClient();
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    onRouterTransitionStart("/pricing", "push");
    await flush();

    expect(state.loads).toEqual([]);
    expect(state.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  test("OBSERVABILITY_SENTRY=true: loads the SDK asynchronously and forwards route transitions once ready", async () => {
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

  test("a route transition before the SDK is ready is skipped without throwing, and forwarded normally once ready", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    // Stall the SDK load to simulate a route transition before Sentry initializes.
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
