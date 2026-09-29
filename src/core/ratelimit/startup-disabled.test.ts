// @vitest-environment node
// The branch where rate limiting is off entirely (features.rateLimit / ai / upload all off, and no
// per-key limits): no feature that needs rate limiting is on, so the startup check must stay quiet —
// including self-hosted production without Redis. That error log (see startup.test.ts) should only
// appear when something will actually use rate limiting.
// The demo site never reaches this branch (its config has these on), so it's tested with a config
// stand-in, following the site.config stand-ins in startup.test.ts and
// src/core/changelog/disabled.test.ts.
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

describe("all rate-limited features disabled", () => {
  test("logs nothing even in self-hosted production without Redis", () => {
    const log = { warn: vi.fn(), error: vi.fn() };

    warnIfRateLimitUnconfigured({
      runtimeEnv: { NODE_ENV: "production" },
      log,
    });

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
