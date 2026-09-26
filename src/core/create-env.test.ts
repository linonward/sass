// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createAppEnv, requiredWhen } from "./create-env";
import {
  emailServerEnv,
  nonResendEmailAllowed,
  resolveEmailTransport,
} from "./email/env";

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

  test("SKIP_ENV_VALIDATION 跳过校验（非生产运行时）", () => {
    expect(() => aiEnv(true, { SKIP_ENV_VALIDATION: "1" })).not.toThrow();
    expect(() =>
      aiEnv(true, { NODE_ENV: "development", SKIP_ENV_VALIDATION: "1" }),
    ).not.toThrow();
  });

  // T805：生产运行时（next build / next start / Docker）不再认这个开关。
  test("生产运行时 SKIP_ENV_VALIDATION 不生效，缺少必填项照旧报错", () => {
    expect(() =>
      aiEnv(true, { NODE_ENV: "production", SKIP_ENV_VALIDATION: "1" }),
    ).toThrow("- AI_API_KEY: ");
  });

  test("生产运行时变量齐全时照常通过校验", () => {
    const env = createAppEnv({
      server: { AI_API_KEY: z.string().min(1) },
      runtimeEnv: {
        NODE_ENV: "production",
        SKIP_ENV_VALIDATION: "1",
        AI_API_KEY: "sk-test",
      },
    });
    expect(env.AI_API_KEY).toBe("sk-test");
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
    // 显式设置仍然优先（默认选择逻辑没动）；生产下这个组合能不能用由校验决定，见下面的用例。
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }, "file"],
    [{ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" }, "resend"],
  ])("%o 解析为 %s", (runtimeEnv, expected) => {
    expect(resolveEmailTransport(runtimeEnv)).toBe(expected);
  });

  test.each<[Record<string, string | undefined>, boolean]>([
    [{}, true],
    [{ NODE_ENV: "test" }, true],
    [{ NODE_ENV: "development", EMAIL_TRANSPORT: "console" }, true],
    [{ NODE_ENV: "development", EMAIL_TRANSPORT: "file" }, true],
    [{ NODE_ENV: "production", RESEND_API_KEY: "re_x" }, true],
    [{ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" }, true],
    // T805 收紧的这几格：生产运行时不再允许 console / file。
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }, false],
    [{ NODE_ENV: "production", EMAIL_TRANSPORT: "console" }, false],
    [{ VERCEL_ENV: "production", EMAIL_TRANSPORT: "file" }, false],
    // 上面这几格在收紧前都是 true。
    // 显式放行（CI 的 e2e 跑在生产构建上）：下面两格保持 true。
    [
      {
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "file",
        ALLOW_NON_RESEND_EMAIL: "1",
      },
      true,
    ],
    [
      {
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "console",
        ALLOW_NON_RESEND_EMAIL: "true",
        RESEND_API_KEY: "re_x",
      },
      true,
    ],
  ])("%o 校验通过 = %s", (runtimeEnv, passes) => {
    const run = () => emailEnv(runtimeEnv);
    if (passes) expect(run).not.toThrow();
    else expect(run).toThrow("- EMAIL_TRANSPORT: ");
  });

  test("生产运行时 console / file 启动报错，并给出放行开关", () => {
    expect(() =>
      emailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "console" }),
    ).toThrow("- EMAIL_TRANSPORT: ");
    expect(() =>
      emailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "file" }),
    ).toThrow('must be "resend" in a production runtime');
    // Vercel 的生产环境即使没设 NODE_ENV 也算生产；预览部署是生产构建，同样只允许 resend。
    expect(() =>
      emailEnv({
        VERCEL_ENV: "production",
        EMAIL_TRANSPORT: "file",
        RESEND_API_KEY: "re_x",
      }),
    ).toThrow("- EMAIL_TRANSPORT: ");
    expect(() =>
      emailEnv({
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "file",
        RESEND_API_KEY: "re_x",
      }),
    ).toThrow("- EMAIL_TRANSPORT: ");
  });

  test("生产运行时显式 ALLOW_NON_RESEND_EMAIL=1 才放行 console / file", () => {
    for (const ALLOW_NON_RESEND_EMAIL of ["1", "true"]) {
      expect(
        emailEnv({
          NODE_ENV: "production",
          EMAIL_TRANSPORT: "file",
          ALLOW_NON_RESEND_EMAIL,
        }).EMAIL_TRANSPORT,
      ).toBe("file");
    }
    // 0 / false 和不填等价。
    for (const ALLOW_NON_RESEND_EMAIL of ["0", "false"]) {
      expect(() =>
        emailEnv({
          NODE_ENV: "production",
          EMAIL_TRANSPORT: "file",
          ALLOW_NON_RESEND_EMAIL,
        }),
      ).toThrow("- EMAIL_TRANSPORT: ");
    }
  });

  test("ALLOW_NON_RESEND_EMAIL 只接受 1 / true / 0 / false", () => {
    for (const ALLOW_NON_RESEND_EMAIL of ["1", "true", "0", "false"]) {
      expect(() => emailEnv({ ALLOW_NON_RESEND_EMAIL })).not.toThrow();
    }
    expect(() => emailEnv({ ALLOW_NON_RESEND_EMAIL: "yes" })).toThrow(
      "- ALLOW_NON_RESEND_EMAIL: ",
    );
  });

  // nonResendEmailAllowed 真值表：VERCEL_ENV × NODE_ENV × ALLOW_NON_RESEND_EMAIL。
  test.each<[Record<string, string | undefined>, boolean]>([
    [{}, true],
    [{ NODE_ENV: "development" }, true],
    [{ NODE_ENV: "test" }, true],
    [{ VERCEL_ENV: "preview", NODE_ENV: "development" }, true],
    [{ NODE_ENV: "production" }, false],
    [{ VERCEL_ENV: "production" }, false],
    [{ VERCEL_ENV: "production", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "1" }, true],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "true" }, true],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "0" }, false],
    [{ NODE_ENV: "production", ALLOW_NON_RESEND_EMAIL: "false" }, false],
    [{ VERCEL_ENV: "production", ALLOW_NON_RESEND_EMAIL: "1" }, true],
  ])("%o 允许非 resend 传输 = %s", (runtimeEnv, allowed) => {
    expect(nonResendEmailAllowed(runtimeEnv)).toBe(allowed);
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
