// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createAppEnv, requiredWhen } from "./create-env";

function aiEnv(ai: boolean, runtimeEnv: Record<string, string | undefined>) {
  return createAppEnv({
    server: { AI_API_KEY: requiredWhen(ai, z.string().min(1)) },
    runtimeEnv,
  });
}

describe("createAppEnv", () => {
  test("feature 开启时缺少变量会报错，并指出变量名", () => {
    expect(() => aiEnv(true, {})).toThrow("- AI_API_KEY: ");
  });

  test("feature 开启时空字符串视为未填", () => {
    expect(() => aiEnv(true, { AI_API_KEY: "" })).toThrow("- AI_API_KEY: ");
  });

  test("feature 开启且填写了变量时通过", () => {
    expect(aiEnv(true, { AI_API_KEY: "sk-test" }).AI_API_KEY).toBe("sk-test");
  });

  test("feature 关闭时不再要求该变量", () => {
    expect(aiEnv(false, {}).AI_API_KEY).toBeUndefined();
  });

  test("feature 关闭但填了非法值时仍然报错", () => {
    const env = () =>
      createAppEnv({
        server: { AI_TIMEOUT: requiredWhen(false, z.coerce.number()) },
        runtimeEnv: { AI_TIMEOUT: "soon" },
      });
    expect(env).toThrow("- AI_TIMEOUT: ");
  });

  test("NODE_ENV 非法时报错", () => {
    expect(() => aiEnv(false, { NODE_ENV: "staging" })).toThrow("- NODE_ENV: ");
  });

  test("SKIP_ENV_VALIDATION 跳过校验", () => {
    expect(() => aiEnv(true, { SKIP_ENV_VALIDATION: "1" })).not.toThrow();
  });
});
