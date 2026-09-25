import { describe, expect, test } from "vitest";

import { cooldownIdentifier, remainingCooldown } from "./cooldown";

describe("remainingCooldown", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("没有记录或已过期时为 0", () => {
    expect(remainingCooldown(undefined, now)).toBe(0);
    expect(remainingCooldown(new Date("2025-12-31T23:59:59Z"), now)).toBe(0);
  });

  test("冷却中时向上取整到秒", () => {
    expect(remainingCooldown(new Date("2026-01-01T00:00:59.200Z"), now)).toBe(
      60,
    );
    expect(remainingCooldown(new Date("2026-01-01T00:00:01Z"), now)).toBe(1);
  });
});

test("冷却记录按邮箱归一化，并与验证码记录区分", () => {
  expect(cooldownIdentifier(" Ada@Example.com ")).toBe(
    "otp-resend-cooldown:ada@example.com",
  );
});
