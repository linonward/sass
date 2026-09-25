// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";

import type { AiProvider } from "../config/schema";
import { createAppEnv } from "../create-env";
import { aiServerEnv } from "./env";

function check(
  runtimeEnv: Record<string, string | undefined>,
  providers: AiProvider[] = ["openai", "anthropic"],
  enabled = true,
) {
  return () =>
    createAppEnv({
      server: aiServerEnv(runtimeEnv, { enabled, providers }),
      runtimeEnv,
    });
}

describe("aiServerEnv", () => {
  test("Vercel 生产环境开启 AI 时，模型用到的每家服务商都要有 key", () => {
    const production = { VERCEL_ENV: "production" };
    expect(check(production)).toThrow("- OPENAI_API_KEY: ");
    expect(check(production)).toThrow("- ANTHROPIC_API_KEY: ");
    expect(
      check({ ...production, OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "a" }),
    ).not.toThrow();
  });

  test("用到百炼时要求 ALIBABA_API_KEY，ALIBABA_BASE_URL 可选但必须是 URL", () => {
    const production = { VERCEL_ENV: "production" };
    expect(check(production, ["alibaba"])).toThrow("- ALIBABA_API_KEY: ");
    expect(
      check({ ...production, ALIBABA_API_KEY: "sk-x" }, ["alibaba"]),
    ).not.toThrow();
    expect(check({ ALIBABA_BASE_URL: "dashscope" }, ["alibaba"])).toThrow(
      "- ALIBABA_BASE_URL: ",
    );
  });

  test("没用到的服务商不要求", () => {
    expect(
      check({ VERCEL_ENV: "production", OPENAI_API_KEY: "sk-x" }, ["openai"]),
    ).not.toThrow();
  });

  test("没开 AI 时生产环境也不要求", () => {
    expect(
      check({ VERCEL_ENV: "production" }, ["openai"], false),
    ).not.toThrow();
  });

  test("本地、CI 和预览不要求", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });
});
