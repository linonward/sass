// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import { billingServerEnv, fakeBillingAllowed } from "./env";

function check(
  runtimeEnv: Record<string, string | undefined>,
  hasPaidPlans = true,
) {
  return () =>
    createAppEnv({
      server: billingServerEnv(runtimeEnv, { hasPaidPlans }),
      runtimeEnv,
    });
}

const creem = {
  CREEM_API_KEY: "creem_test_x",
  CREEM_WEBHOOK_SECRET: "whsec_x",
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
    expect(check({ VERCEL_ENV: "production" }, false)).not.toThrow();
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

  test("fake 服务商只在本地和 CI 允许", () => {
    expect(check({ BILLING_PROVIDER: "fake" })).not.toThrow();
    expect(check({ BILLING_PROVIDER: "fake", VERCEL_ENV: "preview" })).toThrow(
      "- BILLING_PROVIDER: ",
    );
    expect(
      check({ BILLING_PROVIDER: "fake", VERCEL_ENV: "production", ...creem }),
    ).toThrow("- BILLING_PROVIDER: ");
    expect(check({ BILLING_PROVIDER: "fake", CREEM_MODE: "live" })).toThrow(
      "- BILLING_PROVIDER: ",
    );
    expect(fakeBillingAllowed({})).toBe(true);
    expect(fakeBillingAllowed({ VERCEL_ENV: "development" })).toBe(false);
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
});
