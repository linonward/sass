// @vitest-environment node
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";

import { handleChat, MAX_CHAT_BODY_BYTES, type ChatDeps } from "./chat";
import type { RunAIResult } from "./run";

function okResult(): RunAIResult {
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hi there" },
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    }),
    prompt: "Hi",
  });
  return {
    ok: true,
    usageId: "u",
    model: { id: "fast", provider: "openai", model: "m", creditCost: 1 },
    result,
    settled: Promise.resolve("succeeded"),
  };
}

const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] },
];

function setup(overrides: Partial<ChatDeps> = {}) {
  const deps = {
    enabled: true,
    getUserId: vi.fn(async () => "user-1"),
    runAI: vi.fn(async () => okResult()),
    after: vi.fn(),
    ...overrides,
  };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      deps,
    );
  return { deps, post };
}

describe("handleChat", () => {
  test("流式返回模型输出，并把记账登记到 after", async () => {
    const { deps, post } = setup();
    const response = await post(
      { messages, modelId: "fast" },
      { "x-forwarded-for": "1.2.3.4" },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Hi there");
    expect(deps.runAI).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        ip: "1.2.3.4",
        modelId: "fast",
      }),
    );
    expect(deps.after).toHaveBeenCalledOnce();
  });

  test("features.ai 关闭时 404", async () => {
    const { post } = setup({ enabled: false });
    expect((await post({ messages })).status).toBe(404);
  });

  test("未登录 401，不调用模型", async () => {
    const { deps, post } = setup({ getUserId: async () => null });
    expect((await post({ messages })).status).toBe(401);
    expect(deps.runAI).not.toHaveBeenCalled();
  });

  test.each([
    ["不是 JSON", "nope"],
    ["没有 messages", {}],
    ["messages 格式不对", { messages: [{ role: "user" }] }],
  ])("请求体%s时 400", async (_, body) => {
    const { deps, post } = setup();
    expect((await post(body)).status).toBe(400);
    expect(deps.runAI).not.toHaveBeenCalled();
  });

  test("请求体过大 413", async () => {
    const { post } = setup();
    const big = "x".repeat(MAX_CHAT_BODY_BYTES);
    const response = await post({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: big }] },
      ],
    });
    expect(response.status).toBe(413);
  });

  test("runAI 拒绝时原样返回它的响应（402 / 429）", async () => {
    const rejected = Response.json(
      { error: "insufficient_credits" },
      { status: 402 },
    );
    const { post } = setup({
      runAI: async () => ({ ok: false, status: 402, response: rejected }),
    });
    const response = await post({ messages });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "insufficient_credits" });
  });
});
