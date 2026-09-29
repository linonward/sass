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
  test("does nothing when no SDK is registered", () => {
    expect(() => reportToSentry(new Error("x"), "x.failed", {})).not.toThrow();
  });

  test("reports the error itself, with the event name as a tag, userId as the user, and other fields as extras", () => {
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

  test("creates an Error from the event name when there is none", () => {
    const { api, scope } = fakeSentry();
    reportToSentry(undefined, "ai.provider_down", { model: "fast" });
    const captured = api.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("ai.provider_down");
    expect(scope.setUser).not.toHaveBeenCalled();
  });

  test("wired into the logger: logger.error reports with redacted fields", () => {
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
  test("sends only the user ID and clears it on sign-out", () => {
    const { api } = fakeSentry();
    identifyUser("u_1");
    identifyUser(null);
    expect(api.setUser.mock.calls).toEqual([[{ id: "u_1" }], [null]]);
  });

  test("captureError forwards to the SDK and is silent when none is registered", () => {
    expect(() => captureError(new Error("x"))).not.toThrow();
    const { api } = fakeSentry();
    const error = new Error("render");
    captureError(error);
    expect(api.captureException).toHaveBeenCalledWith(error);
  });

  test("init options don't collect cookies, IP, query strings, request bodies, or local variables", () => {
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

  test("in the browser, a user set before the SDK loads is applied on registration", () => {
    vi.stubGlobal("window", {});
    try {
      identifyUser("u_early");
      const { api } = fakeSentry();
      expect(api.setUser).toHaveBeenCalledWith({ id: "u_early" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("on the server, doesn't buffer the user before the SDK registers (would leak into other requests)", () => {
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

describe("Sentry variables", () => {
  const env = (sentry: boolean, runtimeEnv: Record<string, string>) =>
    createAppEnv({
      server: observabilityServerEnv(),
      client: observabilityClientEnv({ sentry }),
      runtimeEnv,
    });

  test("requires no variables when off", () => {
    expect(() => env(false, {})).not.toThrow();
  });

  test("when on, requires the DSN; source map variables are optional", () => {
    expect(() => env(true, {})).toThrow("- NEXT_PUBLIC_SENTRY_DSN: ");
    expect(() => env(true, { NEXT_PUBLIC_SENTRY_DSN: "not a url" })).toThrow(
      "- NEXT_PUBLIC_SENTRY_DSN: ",
    );
    expect(
      env(true, { NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" })
        .NEXT_PUBLIC_SENTRY_DSN,
    ).toBe("https://k@o1.ingest.sentry.io/1");
  });

  test("uploads source maps only when all three are set", () => {
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

test("the proxy matcher skips the Sentry tunnel route", () => {
  // The matcher must be a literal, so this guards against updating one side and not the other.
  const source = readFileSync(
    new URL("../../proxy.ts", import.meta.url),
    "utf8",
  );
  // The value sits right at printWidth; adding or removing a path makes prettier wrap it onto the
  // next line, so don't match only the single-line form.
  const matcher = /matcher:\s*"([^"]+)"/.exec(source)?.[1] ?? "";
  expect(matcher).toContain(`|${SENTRY_TUNNEL_ROUTE.slice(1)}|`);
});
