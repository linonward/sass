import { describe, expect, test, vi } from "vitest";

import type { Database } from "@/core/db";

// Hidden plans (SITE_HIDDEN_PLANS) can't be bought: checkout rejects them before touching the
// database or the provider.
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

describe("checkout and hidden plans", () => {
  test("a hidden plan returns invalid_plan without calling the provider or the rate limiter", async () => {
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
