// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
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

describe("billingServerEnv", () => {
  test("Vercel 生产环境且有付费套餐时，缺少 Creem 凭据会报错", () => {
    expect(check({ VERCEL_ENV: "production" })).toThrow("- CREEM_API_KEY: ");
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- CREEM_WEBHOOK_SECRET: ",
    );
    expect(check({ VERCEL_ENV: "production", ...creem })).not.toThrow();
  });

  test("没有付费套餐时生产环境也不要求", () => {
    expect(
      check({ VERCEL_ENV: "production" }, { hasPaidPlans: false }),
    ).not.toThrow();
  });

  test("只有生效服务商的密钥是必填的", () => {
    // 生效服务商是 creem（site.config.ts 的默认值）：配了 Stripe 的密钥也不要求 Creem 之外的，
    // 反过来同理 —— 用 Creem 的站点不该被迫填 Stripe 的密钥，否则部署直接起不来。
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
    // Creem 的密钥填不填都不影响 Stripe 站点。
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

  test("BILLING_PROVIDER 覆盖生效服务商时按它判断必填", () => {
    // 站点配置的是 creem，但运行时切到了 stripe：这时要的是 Stripe 的密钥。
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

  test("BILLING_PROVIDER 默认取配置里的 provider", () => {
    expect(check({})().BILLING_PROVIDER).toBe("creem");
    expect(check({}, { provider: "stripe" })().BILLING_PROVIDER).toBe("stripe");
    expect(check({ BILLING_PROVIDER: "fake" })).toThrow("- BILLING_PROVIDER: ");
    expect(
      check({ NODE_ENV: "test", BILLING_PROVIDER: "fake" })().BILLING_PROVIDER,
    ).toBe("fake");
    expect(check({ BILLING_PROVIDER: "paddle" })).toThrow(
      "- BILLING_PROVIDER: ",
    );
  });

  test("本地、CI 和预览不要求", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  test("CREEM_MODE 默认 test，只接受 test 或 live", () => {
    expect(check({})().CREEM_MODE).toBe("test");
    expect(check({ CREEM_MODE: "live" })().CREEM_MODE).toBe("live");
    expect(check({ CREEM_MODE: "prod" })).toThrow("- CREEM_MODE: ");
  });

  test("成功页超时默认 60 秒，可以调短", () => {
    expect(check({})().BILLING_SUCCESS_TIMEOUT_MS).toBe(60_000);
    expect(
      check({ BILLING_SUCCESS_TIMEOUT_MS: "5000" })()
        .BILLING_SUCCESS_TIMEOUT_MS,
    ).toBe(5000);
    expect(check({ BILLING_SUCCESS_TIMEOUT_MS: "0" })).toThrow(
      "- BILLING_SUCCESS_TIMEOUT_MS: ",
    );
  });

  test("本地（next dev）设 fake 能通过校验", () => {
    expect(
      check({ NODE_ENV: "development", BILLING_PROVIDER: "fake" }),
    ).not.toThrow();
    expect(check({ NODE_ENV: "test", BILLING_PROVIDER: "fake" })).not.toThrow();
  });

  test("生产运行时设 fake 会启动失败（自托管 next start / Docker）", () => {
    // 收紧前后唯一的差别：这里以前能静默启动，现在必须报错。
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
    // NODE_ENV 没设置（自建服务忘了设）也按生产处理。
    expect(check({ BILLING_PROVIDER: "fake" })).toThrow("- BILLING_PROVIDER: ");
  });

  test("生产运行时只有显式 ALLOW_FAKE_BILLING=1 才放行 fake（CI 的 e2e）", () => {
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
    // 0 / false 和不填等价。
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

  test("Vercel 和 CREEM_MODE=live 是硬锁，ALLOW_FAKE_BILLING 也不放开", () => {
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

  test("ALLOW_FAKE_BILLING 只接受 1 / true / 0 / false", () => {
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

// fakeBillingAllowed 的真值表。列：NODE_ENV、VERCEL_ENV、CREEM_MODE、STRIPE_SECRET_KEY、
// ALLOW_FAKE_BILLING → 期望。
// 「不填」表示变量未设置（CREEM_MODE 不填等同 test，「不填」的 NODE_ENV 按生产处理）。
const table: Array<{
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  CREEM_MODE?: string;
  STRIPE_SECRET_KEY?: string;
  ALLOW_FAKE_BILLING?: string;
  allowed: boolean;
}> = [
  // 本地开发与测试：默认放行
  { NODE_ENV: "development", allowed: true },
  { NODE_ENV: "development", CREEM_MODE: "test", allowed: true },
  { NODE_ENV: "test", allowed: true },
  { NODE_ENV: "test", CREEM_MODE: "test", allowed: true },
  // 自托管生产：本任务要堵的洞。下面 6 行在收紧前都是 true（见 PR 的红/绿对照）。
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
  // NODE_ENV 没设置（自建服务 / 非 Next 运行时）：按生产处理
  { CREEM_MODE: "test", allowed: false },
  { allowed: false },
  // CI 的 e2e：生产构建 + 显式开关
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
  // 硬锁一：CREEM_MODE=live（真实扣款）——开关也无效
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
  // 硬锁二：在 Vercel 上（含 vercel dev 的 development）——开关也无效
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
  // 硬锁三：Stripe 的 live 密钥（换了服务商也一样锁死）——开关也无效
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
  // 受限密钥（rk_live_）同样是真实扣款
  { NODE_ENV: "development", STRIPE_SECRET_KEY: "rk_live_x", allowed: false },
  // 测试模式的密钥只影响 Stripe 自己，不锁 fake
  { NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_x", allowed: true },
  { NODE_ENV: "test", STRIPE_SECRET_KEY: "rk_test_x", allowed: true },
  { NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_test_x", allowed: false },
];

describe("fakeBillingAllowed 真值表", () => {
  for (const row of table) {
    const { allowed, ...runtimeEnv } = row;
    const label = (Object.keys(runtimeEnv) as Array<keyof typeof runtimeEnv>)
      .map((key) => `${key}=${runtimeEnv[key]}`)
      .join(" ");
    // 每行都要能看出是哪一格，名字里带上完整的输入组合。
    test(`${label || "全部未设置"} → ${allowed}`, () => {
      expect(fakeBillingAllowed(runtimeEnv)).toBe(allowed);
    });
  }

  test("全组合扫描（NODE_ENV × VERCEL_ENV × CREEM_MODE × STRIPE_SECRET_KEY × ALLOW_FAKE_BILLING）", () => {
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
