// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  checkTargets,
  FAILURE_THRESHOLD,
  HEALTH_TIMEOUT_MS,
  probeHealth,
  shouldOpenIncident,
} from "./health";

/** A fetch that only hangs: when the signal aborts, it throws TimeoutError like browsers do. */
const hangingFetch = ((_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(
        Object.assign(new Error("The operation was aborted"), {
          name: "TimeoutError",
        }),
      );
    });
  })) as unknown as typeof fetch;

const respond = (status: number): typeof fetch =>
  (async () => new Response(null, { status })) as unknown as typeof fetch;

const throwWith = (error: unknown): typeof fetch =>
  (async () => {
    throw error;
  }) as unknown as typeof fetch;

describe("probeHealth", () => {
  test("2xx counts as healthy", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: respond(200) }),
    ).resolves.toEqual({ ok: true, status: 200 });
  });

  test("non-2xx counts as a failure, with the status code in the error", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: respond(503) }),
    ).resolves.toEqual({ ok: false, error: "HTTP 503" });
  });

  test("a timeout always returns within timeoutMs", async () => {
    const started = Date.now();
    const result = await probeHealth("https://example.com", {
      fetchImpl: hangingFetch,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, error: "timeout after 20ms" });
    // The bound is very loose (CI is slow); what matters is that it doesn't wait forever.
    expect(Date.now() - started).toBeLessThan(HEALTH_TIMEOUT_MS);
  });

  test("network errors are passed through as-is", async () => {
    await expect(
      probeHealth("https://example.com", {
        fetchImpl: throwWith(new Error("getaddrinfo ENOTFOUND")),
      }),
    ).resolves.toEqual({ ok: false, error: "getaddrinfo ENOTFOUND" });
  });

  test("non-Error throws are stringified too, so rendering doesn't blow up", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: throwWith("boom") }),
    ).resolves.toEqual({ ok: false, error: "boom" });
  });

  test("the default timeout is 5 seconds", () => {
    expect(HEALTH_TIMEOUT_MS).toBe(5_000);
  });
});

describe("checkTargets", () => {
  test("only probes components that have a healthUrl", () => {
    expect(
      checkTargets({
        api: { label: "API", healthUrl: "https://example.com/health" },
        database: { label: "Database" },
      }),
    ).toEqual([{ component: "api", healthUrl: "https://example.com/health" }]);
  });
});

describe("shouldOpenIncident", () => {
  test("opens only once consecutive failures reach the threshold; one failure is just a blip", () => {
    expect(FAILURE_THRESHOLD).toBe(2);
    expect(shouldOpenIncident(1, false)).toBe(false);
    expect(shouldOpenIncident(2, false)).toBe(true);
  });

  test("doesn't open another one while an automatic incident is ongoing", () => {
    expect(shouldOpenIncident(5, true)).toBe(false);
  });
});
