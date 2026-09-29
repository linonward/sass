// @vitest-environment node
// Startup path: instrumentation.ts reads site.config at the top level and process.env when called,
// so every test does resetModules and re-imports a clean module (vi.doMock swaps in a site.config
// double). The assertions are about whether to load and which module gets loaded — @vercel/otel
// and Sentry are mocked as no-ops and never really initialized.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const logged = vi.hoisted(() => {
  // The order the module factories run in is the load order (OTel before Sentry, see the comment in
  // register()).
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

// These mocks are re-registered per test in load(): vi.mock factory results are cached and don't
// rerun after resetModules, and whether a module got imported is exactly what's asserted here.
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

/** Re-import a clean module per test: site.config is read at the top level, process.env on call. */
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
  // Next.js calls register() once per runtime, distinguished by NEXT_RUNTIME.
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
  test("otel on: registers OTel with the site name, then loads Sentry (Node runtime)", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load({ observability: { otel: true } });

    await register();

    expect(logged.registerOTel).toHaveBeenCalledExactlyOnceWith({
      serviceName: "Instrumentation Test",
    });
    // The order is part of the assertion: with both on, Sentry must reuse the registered tracer provider.
    expect(logged.loaded).toEqual(["otel", "sentry.server"]);
    expect(logged.warnIfRateLimitUnconfigured).toHaveBeenCalledOnce();
  });

  test("otel off: leaves @vercel/otel alone and loads only Sentry", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.registerOTel).not.toHaveBeenCalled();
    expect(logged.loaded).toEqual(["sentry.server"]);
  });

  test("features.observability off: otel isn't registered even when set to true; Sentry follows the env var only", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load({
      features: { observability: false },
      observability: { otel: true },
    });

    await register();

    expect(logged.registerOTel).not.toHaveBeenCalled();
    // OBSERVABILITY_SENTRY is inlined by next.config.ts at build time from features.observability, so
    // the runtime doesn't check features again — when off, the whole block and the SDK aren't in the
    // bundle.
    expect(logged.loaded).toEqual(["sentry.server"]);
  });

  test("Sentry on but the observability variable isn't set: the whole Sentry block isn't loaded", async () => {
    const { register } = await load({ observability: { otel: true } });

    await register();

    expect(logged.registerOTel).toHaveBeenCalledOnce();
    expect(logged.loaded).toEqual(["otel"]);
  });

  test("the Edge runtime loads the edge config and skips the rate limit check", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.loaded).toEqual(["sentry.edge"]);
    // process.env on Edge is incomplete, so the check would flag a correctly configured deployment.
    expect(logged.warnIfRateLimitUnconfigured).not.toHaveBeenCalled();
  });

  test("unknown runtime: neither Sentry config loads and the rate limit check is skipped", async () => {
    vi.stubEnv("NEXT_RUNTIME", "browser");
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { register } = await load();

    await register();

    expect(logged.loaded).toEqual([]);
    expect(logged.warnIfRateLimitUnconfigured).not.toHaveBeenCalled();
  });

  test("without NEXT_RUNTIME no runtime-specific module is loaded", async () => {
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
  test("features.observability off: no logging, no reporting, and the Sentry SDK isn't loaded", async () => {
    vi.stubEnv("OBSERVABILITY_SENTRY", "true");
    const { onRequestError } = await load({
      features: { observability: false },
    });

    await onRequestError(new Error("boom"), request, context);

    expect(logged.loggerError).not.toHaveBeenCalled();
    expect(logged.captureRequestError).not.toHaveBeenCalled();
    expect(logged.loaded).not.toContain("@sentry/nextjs");
  });

  test("Sentry off: only the logger gets it, with the request context as fields", async () => {
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

  test("Sentry on: forwards to captureRequestError (with request context) first, then logs", async () => {
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

  test("path logs only the path: a token in the query stays out of the logs", async () => {
    const { onRequestError } = await load();

    for (const [path, expected] of [
      ["/dashboard?token=secret", "/dashboard"],
      ["/dashboard", "/dashboard"],
      // Anything after a second ? is also query (split keeps the first part).
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
