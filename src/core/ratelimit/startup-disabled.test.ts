// @vitest-environment node
// 限流整个关掉的那一支（features.rateLimit / ai / upload 全部关着，也没有 per-key 限流）：
// 一个需要用限流的功能都没开，启动检查不该说话 —— 包括自托管生产里没配 Redis 的情况，
// 那条 error 日志（见 startup.test.ts）只在真的有东西会用限流时才该出现。
// 演示站上跑不到这一支（配置是开的），所以用配置替身测，写法照 startup.test.ts 和
// src/core/changelog/disabled.test.ts 的 site.config 替身。
import { describe, expect, test, vi } from "vitest";

vi.mock("../../../site.config", async (original) => {
  const configModule = await original<typeof import("../../../site.config")>();
  return {
    ...configModule,
    default: {
      ...configModule.default,
      features: {
        ...configModule.default.features,
        rateLimit: false,
        ai: false,
        upload: false,
      },
    },
  };
});

import { warnIfRateLimitUnconfigured } from "./startup";

describe("限流功能全部关闭", () => {
  test("自托管生产、没配 Redis 也不打日志", () => {
    const log = { warn: vi.fn(), error: vi.fn() };

    warnIfRateLimitUnconfigured({
      runtimeEnv: { NODE_ENV: "production" },
      log,
    });

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
