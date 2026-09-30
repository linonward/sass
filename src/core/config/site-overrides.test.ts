import { afterEach, describe, expect, test, vi } from "vitest";

// site.config.ts reads environment variables at import time: each case re-imports it after
// changing the variables.
async function loadConfig() {
  vi.resetModules();
  return (await import("../../../site.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("site plan overrides (SITE_PRICE_* / SITE_HIDDEN_PLANS)", () => {
  test("without the variables, the template defaults apply", async () => {
    vi.stubEnv("SITE_PRICE_LIFETIME", "");
    vi.stubEnv("SITE_HIDDEN_PLANS", "");
    const config = await loadConfig();
    const lifetime = config.billing.plans.find((p) => p.id === "lifetime")!;
    expect(lifetime.price).toBe(199);
    expect(config.billing.plans.every((p) => !p.hidden)).toBe(true);
  });

  test("overrides list prices and hides plans; hidden plans stay in the config (existing subscriptions still resolve)", async () => {
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

  test("the free plan can be hidden too (a deployment that only sells one-time plans)", async () => {
    vi.stubEnv("SITE_HIDDEN_PLANS", "pro,free");
    await loadConfig();
    const { listedPlans } = await import("../billing/plans");
    expect(listedPlans().map((p) => p.id)).toEqual(["lifetime"]);
  });

  test("a malformed price fails at startup instead of silently using the default", async () => {
    vi.stubEnv("SITE_PRICE_LIFETIME", "ninety-nine");
    await expect(loadConfig()).rejects.toThrow(
      /SITE_PRICE_LIFETIME must be a non-negative number/,
    );
  });
});

describe("downloadable files switch (SITE_DOWNLOADS)", () => {
  test("off by default: no downloads menu item", async () => {
    vi.stubEnv("SITE_DOWNLOADS", "");
    const config = await loadConfig();
    expect(config.downloads.enabled).toBe(false);
    expect(config.dashboard.nav.map((i) => i.href)).not.toContain("/downloads");
  });

  test("SITE_DOWNLOADS=1 turns it on: the sidebar shows downloads and every product maps to a one-time plan", async () => {
    vi.stubEnv("SITE_DOWNLOADS", "1");
    const config = await loadConfig();
    expect(config.downloads.enabled).toBe(true);
    expect(config.dashboard.nav.map((i) => i.href)).toContain("/downloads");
    for (const product of config.downloads.products) {
      const plan = config.billing.plans.find((p) => p.id === product.planId);
      expect(plan?.interval).toBe("once");
    }
  });
});

describe("contact address (SITE_CONTACT_EMAIL)", () => {
  test("without it, the legal pages and Reply-To keep the shipped placeholder", async () => {
    vi.stubEnv("SITE_CONTACT_EMAIL", "");
    const config = await loadConfig();
    expect(config.legal.contactEmail).toBe("support@example.com");
    expect(config.email.replyTo).toBe("support@example.com");
  });

  test("one variable sets both the legal contact address and the Reply-To", async () => {
    vi.stubEnv("SITE_CONTACT_EMAIL", " help@example.org ");
    const config = await loadConfig();
    expect(config.legal.contactEmail).toBe("help@example.org");
    expect(config.email.replyTo).toBe("help@example.org");
    const { placeholderIssues } = await import("./sentinels");
    const paths = placeholderIssues(config).map((issue) => issue.path);
    expect(paths).not.toContain("legal.contactEmail");
    expect(paths).not.toContain("email.replyTo");
  });

  test("a malformed address fails config validation at startup", async () => {
    vi.stubEnv("SITE_CONTACT_EMAIL", "not-an-email");
    await expect(loadConfig()).rejects.toThrow(/contactEmail/);
  });
});

describe("email sender name follows the site name (SITE_NAME)", () => {
  test("without it, both keep the shipped placeholder, which the name check reports", async () => {
    vi.stubEnv("SITE_NAME", "");
    const config = await loadConfig();
    expect(config.name).toBe("Acme");
    expect(config.email.fromName).toBe("Acme");
    // No separate fromName check: the "name" issue covers the sender name too.
    const { placeholderIssues } = await import("./sentinels");
    expect(placeholderIssues(config).map((issue) => issue.path)).toContain(
      "name",
    );
  });

  test("SITE_NAME renames the site and the email sender together", async () => {
    vi.stubEnv("SITE_NAME", "Example Corp");
    const config = await loadConfig();
    expect(config.name).toBe("Example Corp");
    expect(config.email.fromName).toBe("Example Corp");
    const { placeholderIssues } = await import("./sentinels");
    expect(placeholderIssues(config).map((issue) => issue.path)).not.toContain(
      "name",
    );
  });
});
