// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AiModel } from "@/core/config/schema";

import { createModelResolver, enabledProviders } from "./registry";

const deepseek: AiModel = {
  id: "deepseek",
  provider: "alibaba",
  model: "deepseek-v4-flash",
  creditCost: 1,
};

/** 记录请求地址和请求体，返回一个最小的 chat completion。 */
function stubFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return Response.json({
        id: "1",
        created: 0,
        model: deepseek.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }),
  );
  return calls;
}

async function generate(keys: Parameters<typeof createModelResolver>[0]) {
  const model = createModelResolver(keys)(deepseek);
  if (!model || typeof model === "string") throw new Error("no model");
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    reasoning: "none",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alibaba", () => {
  test("有 ALIBABA_API_KEY 才启用", () => {
    expect(enabledProviders({})).not.toContain("alibaba");
    expect(enabledProviders({ ALIBABA_API_KEY: "sk-x" })).toEqual(["alibaba"]);
    expect(createModelResolver({})(deepseek)).toBeNull();
  });

  test("默认走国际站；ALIBABA_BASE_URL 切到其他地域；reasoning none 关掉思考", async () => {
    const calls = stubFetch();
    await generate({ ALIBABA_API_KEY: "sk-x" });
    await generate({
      ALIBABA_API_KEY: "sk-x",
      ALIBABA_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    ]);
    expect(calls[0]!.body).toMatchObject({
      model: "deepseek-v4-flash",
      enable_thinking: false,
    });
  });
});
