import { afterEach, describe, expect, test, vi } from "vitest";

// site.config.ts 在导入时读环境变量：每个用例改完变量后重新导入一份。
async function loadConfig() {
  vi.resetModules();
  return (await import("../../../site.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("站点的套餐覆盖（SITE_PRICE_* / SITE_HIDDEN_PLANS）", () => {
  test("不设变量时就是模板默认值", async () => {
    vi.stubEnv("SITE_PRICE_LIFETIME", "");
    vi.stubEnv("SITE_HIDDEN_PLANS", "");
    const config = await loadConfig();
    const lifetime = config.billing.plans.find((p) => p.id === "lifetime")!;
    expect(lifetime.price).toBe(199);
    expect(config.billing.plans.every((p) => !p.hidden)).toBe(true);
  });

  test("覆盖标价、隐藏套餐；隐藏的套餐仍在配置里（已有订阅照常可查）", async () => {
    vi.stubEnv("SITE_PRICE_LIFETIME", "99");
    vi.stubEnv("SITE_HIDDEN_PLANS", " pro , nope ");
    const config = await loadConfig();
    const byId = Object.fromEntries(config.billing.plans.map((p) => [p.id, p]));
    expect(byId.lifetime).toMatchObject({ price: 99, hidden: false });
    expect(byId.pro).toMatchObject({ price: 19, hidden: true });
    const { listedPlans, getPlan } = await import("../billing/plans");
    expect(listedPlans().map((p) => p.id)).toEqual(["free", "lifetime"]);
    expect(getPlan("pro")).toMatchObject({ id: "pro", hidden: true });
  });

  test("标价写错时启动即报错，不静默用默认价", async () => {
    vi.stubEnv("SITE_PRICE_LIFETIME", "ninety-nine");
    await expect(loadConfig()).rejects.toThrow(
      /SITE_PRICE_LIFETIME must be a non-negative number/,
    );
  });
});
