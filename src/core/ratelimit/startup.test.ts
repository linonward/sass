// @vitest-environment node
// 启动检查读 process.env 和 site.config.ts，按服务端模块测（和 env.test.ts 同理）。
import { describe, expect, test, vi } from "vitest";

import { warnIfRateLimitUnconfigured } from "./startup";

const upstash = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

function run(runtimeEnv: Record<string, string | undefined>) {
  const log = { warn: vi.fn(), error: vi.fn() };
  warnIfRateLimitUnconfigured({ runtimeEnv, log });
  return log;
}

describe("warnIfRateLimitUnconfigured", () => {
  test("自托管生产漏配 Upstash：error 级日志，说清后果和修法", () => {
    const log = run({ NODE_ENV: "production" });
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]?.[0]).toBe("ratelimit.unconfigured");
    const fields = JSON.stringify(log.error.mock.calls[0]?.[1]);
    expect(fields).toContain("UPSTASH_REDIS_REST_URL");
    expect(fields).toContain("ALLOW_UNRATELIMITED"); // 显式放行的出口要写在日志里
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("本地开发、测试和 CI（无 Upstash）不打日志：照常放行，不是故障", () => {
    expect(run({ NODE_ENV: "development" }).error).not.toHaveBeenCalled();
    expect(run({ NODE_ENV: "test" }).error).not.toHaveBeenCalled();
    expect(run({ NODE_ENV: "development" }).warn).not.toHaveBeenCalled();
  });

  test("配好了 Upstash 就不提这件事", () => {
    const log = run({ NODE_ENV: "production", ...upstash });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("自托管生产显式设了 ALLOW_UNRATELIMITED：降为 warn，说明限流确实是关的", () => {
    const log = run({ NODE_ENV: "production", ALLOW_UNRATELIMITED: "1" });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toBe("ratelimit.disabled");
  });

  test("Vercel 预览不判定（预览照旧跳过限流）", () => {
    const log = run({ VERCEL_ENV: "preview", NODE_ENV: "production" });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
