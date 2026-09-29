// @vitest-environment node
// t3-env only validates server variables on the server; under jsdom it would be treated as the client.
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import {
  billingServerEnv,
  fakeBillingAllowed,
  type BillingProviderName,
} from "./env";

function check(
  runtimeEnv: Record<string, string | undefined>,
  {
    hasPaidPlans = true,
    provider = "creem",
  }: { hasPaidPlans?: boolean; provider?: BillingProviderName } = {},
) {
  return () =>
    createAppEnv({
      server: billingServerEnv(runtimeEnv, { hasPaidPlans, provider }),
      runtimeEnv,
    });
}

const creem = {
  CREEM_API_KEY: "creem_test_x",
  CREEM_WEBHOOK_SECRET: "whsec_x",
};

const stripe = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
};

const lemonSqueezy = {
  LEMONSQUEEZY_API_KEY: "ls_test_x",
  LEMONSQUEEZY_WEBHOOK_SECRET: "ls_whsec_x",
  LEMONSQUEEZY_STORE_ID: "12345",
};

describe("billingServerEnv", () => {
  test("in Vercel production with paid plans, missing Creem credentials is an error", () => {
    expect(check({ VERCEL_ENV: "production" })).toThrow("- CREEM_API_KEY: ");
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- CREEM_WEBHOOK_SECRET: ",
    );
    // Only the credentials of the provider in effect (here the site config's default, creem) are
    // required; setting another provider's doesn't matter.
    expect(check({ VERCEL_ENV: "production", ...creem })).not.toThrow();
  });

  test("in Vercel production with paid plans, missing Lemon Squeezy credentials is an error", () => {
    const lemonsqueezy = { provider: "lemonsqueezy" } as const;
    expect(check({ VERCEL_ENV: "production" }, lemonsqueezy)).toThrow(
      "- LEMONSQUEEZY_API_KEY: ",
    );
    expect(check({ VERCEL_ENV: "production" }, lemonsqueezy)).toThrow(
      "- LEMONSQUEEZY_WEBHOOK_SECRET: ",
    );
    // Creating a checkout session needs the store relationship, so the store ID is required like
    // the other two.
    expect(check({ VERCEL_ENV: "production" }, lemonsqueezy)).toThrow(
      "- LEMONSQUEEZY_STORE_ID: ",
    );
    expect(
      check({ VERCEL_ENV: "production", ...lemonSqueezy }, lemonsqueezy),
    ).not.toThrow();
    // Conversely: a site using Creem shouldn't require LS credentials — it starts with one
    // provider's keys missing.
    expect(check({ VERCEL_ENV: "production", ...creem })).not.toThrow();
    // When BILLING_PROVIDER overrides the site config, the overriding provider decides.
    expect(
      check({ VERCEL_ENV: "production", BILLING_PROVIDER: "lemonsqueezy" }),
    ).toThrow("- LEMONSQUEEZY_API_KEY: ");
    expect(
      check({
        VERCEL_ENV: "production",
        BILLING_PROVIDER: "lemonsqueezy",
        ...lemonSqueezy,
      }),
    ).not.toThrow();
  });

  test("not required in production when there are no paid plans", () => {
    expect(
      check({ VERCEL_ENV: "production" }, { hasPaidPlans: false }),
    ).not.toThrow();
  });

  test("only the keys of the provider in effect are required", () => {
    // The provider in effect is creem (the site.config.ts default): having Stripe keys set doesn't make
    // anything beyond Creem's required, and vice versa — a site using Creem shouldn't be forced to set
    // Stripe keys, or the deployment won't start at all.
    expect(check({ VERCEL_ENV: "production" }, { provider: "stripe" })).toThrow(
      "- STRIPE_SECRET_KEY: ",
    );
    expect(check({ VERCEL_ENV: "production" }, { provider: "stripe" })).toThrow(
      "- STRIPE_WEBHOOK_SECRET: ",
    );
    expect(
      check({ VERCEL_ENV: "production", ...stripe }, { provider: "stripe" }),
    ).not.toThrow();
    expect(
      check({ VERCEL_ENV: "production", ...stripe }, { provider: "stripe" }),
    ).not.toThrow();
    // Whether Creem's keys are set doesn't affect a Stripe site.
    expect(
      check(
        { VERCEL_ENV: "production", ...stripe, ...creem },
        { provider: "stripe" },
      ),
    ).not.toThrow();
    expect(
      check({ VERCEL_ENV: "production", ...creem }, { provider: "creem" }),
    ).not.toThrow();
    expect(check({ VERCEL_ENV: "production", ...stripe })).toThrow(
      "- CREEM_API_KEY: ",
    );
  });

  test("when BILLING_PROVIDER overrides the provider in effect, it decides what is required", () => {
    // The site config says creem, but the runtime switched to stripe: now Stripe's keys are required.
    expect(
      check({ VERCEL_ENV: "production", BILLING_PROVIDER: "stripe" }),
    ).toThrow("- STRIPE_SECRET_KEY: ");
    expect(
      check({
        VERCEL_ENV: "production",
        BILLING_PROVIDER: "stripe",
        ...stripe,
      }),
    ).not.toThrow();
    expect(
      check({ VERCEL_ENV: "production", BILLING_PROVIDER: "creem" }),
    ).toThrow("- CREEM_API_KEY: ");
  });

  test("BILLING_PROVIDER defaults to the provider in config", () => {
    expect(check({})().BILLING_PROVIDER).toBe("creem");
    expect(check({}, { provider: "stripe" })().BILLING_PROVIDER).toBe("stripe");
    expect(check({}, { provider: "lemonsqueezy" })().BILLING_PROVIDER).toBe(
      "lemonsqueezy",
    );
    expect(check({ BILLING_PROVIDER: "lemonsqueezy" })().BILLING_PROVIDER).toBe(
      "lemonsqueezy",
    );
    expect(check({ BILLING_PROVIDER: "fake" })).toThrow("- BILLING_PROVIDER: ");
    expect(
      check({ NODE_ENV: "test", BILLING_PROVIDER: "fake" })().BILLING_PROVIDER,
    ).toBe("fake");
    expect(check({ BILLING_PROVIDER: "paddle" })).toThrow(
      "- BILLING_PROVIDER: ",
    );
  });

  test("not required locally, in CI or in preview", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  test("CREEM_MODE defaults to test and only accepts test or live", () => {
    expect(check({})().CREEM_MODE).toBe("test");
    expect(check({ CREEM_MODE: "live" })().CREEM_MODE).toBe("live");
    expect(check({ CREEM_MODE: "prod" })).toThrow("- CREEM_MODE: ");
  });

  test("success page timeout defaults to 60s and can be shortened", () => {
    expect(check({})().BILLING_SUCCESS_TIMEOUT_MS).toBe(60_000);
    expect(
      check({ BILLING_SUCCESS_TIMEOUT_MS: "5000" })()
        .BILLING_SUCCESS_TIMEOUT_MS,
    ).toBe(5000);
    expect(check({ BILLING_SUCCESS_TIMEOUT_MS: "0" })).toThrow(
      "- BILLING_SUCCESS_TIMEOUT_MS: ",
    );
  });

  test("fake passes validation locally (next dev)", () => {
    expect(
      check({ NODE_ENV: "development", BILLING_PROVIDER: "fake" }),
    ).not.toThrow();
    expect(check({ NODE_ENV: "test", BILLING_PROVIDER: "fake" })).not.toThrow();
  });

  test("fake fails at startup in a production runtime (self-hosted next start / Docker)", () => {
    // The only difference from before tightening: this used to start silently and now must error.
    expect(check({ NODE_ENV: "production", BILLING_PROVIDER: "fake" })).toThrow(
      "- BILLING_PROVIDER: ",
    );
    expect(
      check({
        NODE_ENV: "production",
        CREEM_MODE: "test",
        BILLING_PROVIDER: "fake",
      }),
    ).toThrow("- BILLING_PROVIDER: ");
    // An unset NODE_ENV (a self-built server that forgot to set it) is treated as production too.
    expect(check({ BILLING_PROVIDER: "fake" })).toThrow("- BILLING_PROVIDER: ");
  });

  test("in a production runtime, fake is only allowed with an explicit ALLOW_FAKE_BILLING=1 (CI e2e)", () => {
    for (const ALLOW_FAKE_BILLING of ["1", "true"]) {
      expect(
        check({
          NODE_ENV: "production",
          CREEM_MODE: "test",
          BILLING_PROVIDER: "fake",
          ALLOW_FAKE_BILLING,
        }),
      ).not.toThrow();
    }
    // 0 / false are the same as unset.
    for (const ALLOW_FAKE_BILLING of ["0", "false"]) {
      expect(
        check({
          NODE_ENV: "production",
          BILLING_PROVIDER: "fake",
          ALLOW_FAKE_BILLING,
        }),
      ).toThrow("- BILLING_PROVIDER: ");
    }
  });

  test("Vercel and CREEM_MODE=live are hard locks that ALLOW_FAKE_BILLING doesn't lift", () => {
    expect(
      check({
        BILLING_PROVIDER: "fake",
        VERCEL_ENV: "preview",
        ALLOW_FAKE_BILLING: "1",
      }),
    ).toThrow("- BILLING_PROVIDER: ");
    expect(
      check({
        BILLING_PROVIDER: "fake",
        VERCEL_ENV: "production",
        ALLOW_FAKE_BILLING: "1",
        ...creem,
      }),
    ).toThrow("- BILLING_PROVIDER: ");
    expect(
      check({
        BILLING_PROVIDER: "fake",
        CREEM_MODE: "live",
        ALLOW_FAKE_BILLING: "1",
      }),
    ).toThrow("- BILLING_PROVIDER: ");
  });

  test("ALLOW_FAKE_BILLING only accepts 1 / true / 0 / false", () => {
    for (const ALLOW_FAKE_BILLING of ["1", "true", "0", "false"]) {
      expect(check({ ALLOW_FAKE_BILLING })).not.toThrow();
    }
    expect(check({ ALLOW_FAKE_BILLING: "yes" })).toThrow(
      "- ALLOW_FAKE_BILLING: ",
    );
    expect(check({ ALLOW_FAKE_BILLING: "TRUE" })).toThrow(
      "- ALLOW_FAKE_BILLING: ",
    );
  });
});

// Truth table for fakeBillingAllowed. Columns: NODE_ENV, VERCEL_ENV, CREEM_MODE, STRIPE_SECRET_KEY,
// ALLOW_FAKE_BILLING → expected.
// "Unset" means the variable isn't set (unset CREEM_MODE equals test; unset NODE_ENV is treated as
// production).
const table: Array<{
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  CREEM_MODE?: string;
  STRIPE_SECRET_KEY?: string;
  WAFFO_MODE?: string;
  ALLOW_FAKE_BILLING?: string;
  allowed: boolean;
}> = [
  // Local development and tests: allowed by default
  { NODE_ENV: "development", allowed: true },
  { NODE_ENV: "development", CREEM_MODE: "test", allowed: true },
  { NODE_ENV: "test", allowed: true },
  { NODE_ENV: "test", CREEM_MODE: "test", allowed: true },
  // Self-hosted production: the hole this tightening closes. The 6 rows below were all true before it.
  { NODE_ENV: "production", CREEM_MODE: "test", allowed: false },
  { NODE_ENV: "production", allowed: false },
  {
    NODE_ENV: "production",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "0",
    allowed: false,
  },
  {
    NODE_ENV: "production",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "false",
    allowed: false,
  },
  // NODE_ENV unset (self-built server / non-Next runtime): treated as production
  { CREEM_MODE: "test", allowed: false },
  { allowed: false },
  // CI e2e: production build + explicit switch
  {
    NODE_ENV: "production",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "1",
    allowed: true,
  },
  {
    NODE_ENV: "production",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "true",
    allowed: true,
  },
  { NODE_ENV: "production", ALLOW_FAKE_BILLING: "1", allowed: true },
  { CREEM_MODE: "test", ALLOW_FAKE_BILLING: "1", allowed: true },
  // Hard lock one: CREEM_MODE=live (real charges) — the switch has no effect
  { NODE_ENV: "development", CREEM_MODE: "live", allowed: false },
  { NODE_ENV: "test", CREEM_MODE: "live", allowed: false },
  { NODE_ENV: "production", CREEM_MODE: "live", allowed: false },
  {
    NODE_ENV: "development",
    CREEM_MODE: "live",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  {
    NODE_ENV: "production",
    CREEM_MODE: "live",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  // Hard lock: WAFFO_MODE=prod (real payments) — the switch has no effect; test doesn't matter
  { NODE_ENV: "development", WAFFO_MODE: "prod", allowed: false },
  {
    NODE_ENV: "development",
    WAFFO_MODE: "prod",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  { NODE_ENV: "development", WAFFO_MODE: "test", allowed: true },
  // Hard lock two: on Vercel (including vercel dev's development) — the switch has no effect
  { NODE_ENV: "development", VERCEL_ENV: "development", allowed: false },
  { NODE_ENV: "production", VERCEL_ENV: "preview", allowed: false },
  { NODE_ENV: "production", VERCEL_ENV: "production", allowed: false },
  {
    NODE_ENV: "development",
    VERCEL_ENV: "development",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    CREEM_MODE: "test",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    CREEM_MODE: "live",
    allowed: false,
  },
  // Hard lock three: live Stripe keys (locked even with a different provider) — the switch has no effect
  {
    NODE_ENV: "development",
    STRIPE_SECRET_KEY: "sk_live_x",
    allowed: false,
  },
  { NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_live_x", allowed: false },
  {
    NODE_ENV: "development",
    STRIPE_SECRET_KEY: "sk_live_x",
    ALLOW_FAKE_BILLING: "1",
    allowed: false,
  },
  // Restricted keys (rk_live_) also make real charges
  { NODE_ENV: "development", STRIPE_SECRET_KEY: "rk_live_x", allowed: false },
  // Test-mode keys only affect Stripe itself and don't lock fake
  { NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_x", allowed: true },
  { NODE_ENV: "test", STRIPE_SECRET_KEY: "rk_test_x", allowed: true },
  { NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_test_x", allowed: false },
];

describe("fakeBillingAllowed truth table", () => {
  test("Lemon Squeezy variables play no part (there's no usable signal, so no hard lock on purpose)", () => {
    // The same cell for Creem is blocked by CREEM_MODE=live; Lemon Squeezy has no mode variable
    // (test vs.
    // real payments is a toggle on the store), and neither the key nor the store ID reveals the mode, so
    // there's no signal to build — the result is exactly the same as without these variables; we can't
    // block or allow out of thin air.
    expect(
      fakeBillingAllowed({
        NODE_ENV: "production",
        LEMONSQUEEZY_API_KEY: "ls_some_key",
        LEMONSQUEEZY_STORE_ID: "12345",
        ALLOW_FAKE_BILLING: "1",
      }),
    ).toBe(true);
  });

  for (const row of table) {
    const { allowed, ...runtimeEnv } = row;
    const label = (Object.keys(runtimeEnv) as Array<keyof typeof runtimeEnv>)
      .map((key) => `${key}=${runtimeEnv[key]}`)
      .join(" ");
    // Each row must show which cell it is, so the name includes the full input combination.
    test(`${label || "all unset"} → ${allowed}`, () => {
      expect(fakeBillingAllowed(runtimeEnv)).toBe(allowed);
    });
  }

  test("full combination sweep (NODE_ENV × VERCEL_ENV × CREEM_MODE × STRIPE_SECRET_KEY × ALLOW_FAKE_BILLING)", () => {
    const nodeEnvs = ["development", "test", "production", undefined];
    const vercelEnvs = [undefined, "development", "preview", "production"];
    const creemModes = [undefined, "test", "live"];
    const stripeKeys = [
      undefined,
      "sk_test_x",
      "sk_live_x",
      "rk_live_x",
      "rk_test_x",
    ];
    const optIns = [undefined, "1", "true", "0", "false"];

    for (const NODE_ENV of nodeEnvs) {
      for (const VERCEL_ENV of vercelEnvs) {
        for (const CREEM_MODE of creemModes) {
          for (const STRIPE_SECRET_KEY of stripeKeys) {
            for (const ALLOW_FAKE_BILLING of optIns) {
              const runtimeEnv = {
                NODE_ENV,
                VERCEL_ENV,
                CREEM_MODE,
                STRIPE_SECRET_KEY,
                ALLOW_FAKE_BILLING,
              };
              const actual = fakeBillingAllowed(runtimeEnv);
              const optIn =
                ALLOW_FAKE_BILLING === "1" || ALLOW_FAKE_BILLING === "true";
              const liveStripeKey = /^(sk|rk)_live_/.test(
                STRIPE_SECRET_KEY ?? "",
              );
              const expected =
                !VERCEL_ENV &&
                CREEM_MODE !== "live" &&
                !liveStripeKey &&
                (optIn || NODE_ENV === "development" || NODE_ENV === "test");
              expect({ ...runtimeEnv, allowed: actual }).toEqual({
                ...runtimeEnv,
                allowed: expected,
              });
            }
          }
        }
      }
    }
  });
});
