import { describe, expect, test, vi } from "vitest";

import type { Database } from "@/core/db";

// 隐藏的套餐（SITE_HIDDEN_PLANS）不能新购：结账在碰数据库和服务商之前就拒绝。
vi.mock("./plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plans")>();
  return {
    ...actual,
    getPlan: (id: string) => {
      const plan = actual.getPlan(id);
      return plan && id === "pro" ? { ...plan, hidden: true } : plan;
    },
  };
});

const { startCheckout } = await import("./checkout");

describe("结账与隐藏的套餐", () => {
  test("隐藏的套餐返回 invalid_plan，不调服务商、不限流", async () => {
    const provider = { id: "fake", createCheckout: vi.fn() };
    const checkRateLimit = vi.fn();
    const result = await startCheckout({
      db: {} as Database,
      provider: provider as never,
      user: { id: "u1", email: "u1@example.com" },
      planId: "pro",
      locale: "en",
      origin: "https://sass.test",
      checkRateLimit,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(provider.createCheckout).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
