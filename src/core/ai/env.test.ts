// @vitest-environment node
// t3-env only validates server variables on the server, and jsdom is treated as the client.
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
  test("with AI on in Vercel production, every provider used by the models needs a key", () => {
    const production = { VERCEL_ENV: "production" };
    expect(check(production)).toThrow("- OPENAI_API_KEY: ");
    expect(check(production)).toThrow("- ANTHROPIC_API_KEY: ");
    expect(
      check({ ...production, OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "a" }),
    ).not.toThrow();
  });

  test("requires ALIBABA_API_KEY when Model Studio is used; ALIBABA_BASE_URL is optional but must be a URL", () => {
    const production = { VERCEL_ENV: "production" };
    expect(check(production, ["alibaba"])).toThrow("- ALIBABA_API_KEY: ");
    expect(
      check({ ...production, ALIBABA_API_KEY: "sk-x" }, ["alibaba"]),
    ).not.toThrow();
    expect(check({ ALIBABA_BASE_URL: "dashscope" }, ["alibaba"])).toThrow(
      "- ALIBABA_BASE_URL: ",
    );
  });

  test("does not require unused providers", () => {
    expect(
      check({ VERCEL_ENV: "production", OPENAI_API_KEY: "sk-x" }, ["openai"]),
    ).not.toThrow();
  });

  test("does not require keys in production when AI is off", () => {
    expect(
      check({ VERCEL_ENV: "production" }, ["openai"], false),
    ).not.toThrow();
  });

  test("does not require keys locally, in CI, or in preview", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });
});
