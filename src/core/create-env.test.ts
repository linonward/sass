// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createAppEnv, requiredWhen } from "./create-env";
import { emailServerEnv, resolveEmailTransport } from "./email/env";

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

  test("client 变量同样按开关校验", () => {
    const publicEnv = (enabled: boolean, runtimeEnv: Record<string, string>) =>
      createAppEnv({
        server: {},
        client: { NEXT_PUBLIC_DSN: requiredWhen(enabled, z.url()) },
        runtimeEnv,
      });
    expect(() => publicEnv(true, {})).toThrow("- NEXT_PUBLIC_DSN: ");
    expect(publicEnv(false, {}).NEXT_PUBLIC_DSN).toBeUndefined();
    expect(
      publicEnv(true, { NEXT_PUBLIC_DSN: "https://k@o1.ingest.sentry.io/1" })
        .NEXT_PUBLIC_DSN,
    ).toBe("https://k@o1.ingest.sentry.io/1");
  });
});

describe("邮件变量", () => {
  function emailEnv(runtimeEnv: Record<string, string | undefined>) {
    return createAppEnv({ server: emailServerEnv(runtimeEnv), runtimeEnv });
  }

  test.each([
    [{}, "console"],
    [{ NODE_ENV: "test" }, "console"],
    [{ NODE_ENV: "production", RESEND_API_KEY: "re_x" }, "resend"],
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }, "file"],
    [{ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" }, "resend"],
  ])("%o 解析为 %s", (runtimeEnv, expected) => {
    expect(resolveEmailTransport(runtimeEnv)).toBe(expected);
    expect(() => emailEnv(runtimeEnv)).not.toThrow();
  });

  test("生产环境缺少 RESEND_API_KEY 时报错并指出变量名", () => {
    expect(() => emailEnv({ NODE_ENV: "production" })).toThrow(
      "- RESEND_API_KEY: ",
    );
  });

  test("本地未设置任何变量时不要求 RESEND_API_KEY", () => {
    expect(
      emailEnv({ NODE_ENV: "development" }).RESEND_API_KEY,
    ).toBeUndefined();
  });

  test("RESEND_API_KEY 格式不对时报错", () => {
    expect(() =>
      emailEnv({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "sk-123" }),
    ).toThrow("- RESEND_API_KEY: ");
  });

  test("EMAIL_TRANSPORT 取值非法时报错", () => {
    expect(() => emailEnv({ EMAIL_TRANSPORT: "smtp" })).toThrow(
      "- EMAIL_TRANSPORT: ",
    );
  });
});
