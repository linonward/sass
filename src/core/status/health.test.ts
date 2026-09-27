// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  checkTargets,
  FAILURE_THRESHOLD,
  HEALTH_TIMEOUT_MS,
  probeHealth,
  shouldOpenIncident,
} from "./health";

/** 只会挂起的 fetch：等 signal 中止时按浏览器的行为抛 TimeoutError。 */
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
  test("2xx 算健康", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: respond(200) }),
    ).resolves.toEqual({ ok: true, status: 200 });
  });

  test("非 2xx 算失败，错误里带状态码", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: respond(503) }),
    ).resolves.toEqual({ ok: false, error: "HTTP 503" });
  });

  test("超时一定会在 timeoutMs 内返回", async () => {
    const started = Date.now();
    const result = await probeHealth("https://example.com", {
      fetchImpl: hangingFetch,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, error: "timeout after 20ms" });
    // 上限放得很宽（CI 上慢），关键是它没有一直等下去。
    expect(Date.now() - started).toBeLessThan(HEALTH_TIMEOUT_MS);
  });

  test("网络错误原样带出来", async () => {
    await expect(
      probeHealth("https://example.com", {
        fetchImpl: throwWith(new Error("getaddrinfo ENOTFOUND")),
      }),
    ).resolves.toEqual({ ok: false, error: "getaddrinfo ENOTFOUND" });
  });

  test("非 Error 的抛出也转成字符串，不炸渲染", async () => {
    await expect(
      probeHealth("https://example.com", { fetchImpl: throwWith("boom") }),
    ).resolves.toEqual({ ok: false, error: "boom" });
  });

  test("默认超时是 5 秒", () => {
    expect(HEALTH_TIMEOUT_MS).toBe(5_000);
  });
});

describe("checkTargets", () => {
  test("只探测配了 healthUrl 的组件", () => {
    expect(
      checkTargets({
        api: { label: "API", healthUrl: "https://example.com/health" },
        database: { label: "Database" },
      }),
    ).toEqual([{ component: "api", healthUrl: "https://example.com/health" }]);
  });
});

describe("shouldOpenIncident", () => {
  test("连续失败到阈值才开，一次失败只是抖动", () => {
    expect(FAILURE_THRESHOLD).toBe(2);
    expect(shouldOpenIncident(1, false)).toBe(false);
    expect(shouldOpenIncident(2, false)).toBe(true);
  });

  test("已经有进行中的自动 incident 就不再开一条", () => {
    expect(shouldOpenIncident(5, true)).toBe(false);
  });
});
