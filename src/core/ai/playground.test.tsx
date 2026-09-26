import { Profiler } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { chatErrorCode, Playground } from "./playground";

describe("chatErrorCode", () => {
  test.each([
    ['{"error":"insufficient_credits"}', "insufficient_credits"],
    ['{"error":"rate_limited"}', "rate_limited"],
    ["model_error", "model_error"],
    ['{"error":"something_new"}', "generic"],
    ["Failed to fetch", "generic"],
  ])("%s → %s", (message, expected) => {
    expect(chatErrorCode(new Error(message))).toBe(expected);
  });
});

// 流式渲染的回归测试：服务端逐个 delta 推流，useChat 不传 throttle 时**每个分片都会重渲染**
// （@ai-sdk/react/dist/index.d.ts:119-122）。这里用真实的 Chat/transport 路径（只把 fetch
// 换成一段真的 UI message stream），数 Playground 子树提交了多少次，防止 throttle 被摘掉。
//
// 分片之间不等待（`_internal.delay` 直接 resolve，整段流在一个微任务批次里推完），
// 所以这个数字与机器负载无关：实测不节流 64 次提交，节流后 3 次（leading + trailing）。
// 真实模型 30–80 token/s 时，节流把重渲染卡在每秒约 1000/50 = 20 次。
const DELTA_COUNT = 60;
const FULL_TEXT = Array.from({ length: DELTA_COUNT }, (_, i) => i % 10).join(
  "",
);

function stubChatFetch() {
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          _internal: { delay: async () => {} },
          chunks: [
            { type: "text-start", id: "t1" },
            ...Array.from({ length: DELTA_COUNT }, (_, i) => ({
              type: "text-delta" as const,
              id: "t1",
              delta: String(i % 10),
            })),
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: DELTA_COUNT, text: DELTA_COUNT },
              },
            },
          ],
        }),
      }),
    }),
    prompt: "hi",
  });
  const fetchMock = vi.fn(async () => result.toUIMessageStreamResponse());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 渲染真实的 Playground，返回「挂载之后又提交了几次」的计数器。 */
function renderPlayground() {
  const commits: string[] = [];
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Profiler
        id="playground"
        onRender={(_id, phase) => {
          commits.push(phase);
        }}
      >
        <Playground
          models={[{ id: "fast", creditCost: 1 }]}
          defaultModel="fast"
        />
      </Profiler>
    </NextIntlClientProvider>,
  );
  return commits;
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Playground 流式渲染", () => {
  test("整段流式输出不会每个分片重渲染一次", async () => {
    const fetchMock = stubChatFetch();
    const commits = renderPlayground();

    typeAndSend("Hello");
    commits.length = 0;
    // 等整段流走完（文字齐了 + 回到可发送状态）再数，数的是整段流的提交次数。
    await waitFor(
      () => {
        expect(screen.getByText(FULL_TEXT)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Send" })).not.toBeNull();
      },
      { timeout: 5000 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 60 个分片：实测不节流 64 次提交，节流后 3 次。阈值取 DELTA_COUNT / 4 留足余量。
    expect(
      commits.length,
      `${DELTA_COUNT} 个分片提交了 ${commits.length} 次，throttle 可能被摘掉了`,
    ).toBeLessThan(DELTA_COUNT / 4);
  });

  test("节流不丢内容：整段文字完整落地，且之后还能继续输入", async () => {
    stubChatFetch();
    renderPlayground();

    typeAndSend("Hello");
    await waitFor(() => expect(screen.getByText(FULL_TEXT)).toBeTruthy(), {
      timeout: 5000,
    });
    // 用户消息 + 助手回复两条气泡（含屏幕阅读器用的角色标签）。
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText(/^You:/)).toBeTruthy();

    // 流结束后回到 idle：输入框还能打字，Send 重新可用（busy 通过 memo 传进 Composer）。
    // 用 waitFor 等按钮回来：状态切到 ready 可能在最后一段文字之后才提交。
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Second" },
    });
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  test("流式期间打字不会清空或打断输入框", async () => {
    stubChatFetch();
    renderPlayground();

    typeAndSend("Hello");
    // 故意不等流结束就打字（input 状态现在在 Composer 内部，不能因为父组件重渲染被重置）。
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "typing while streaming" },
      });
    });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "typing while streaming",
    );

    await waitFor(() => expect(screen.getByText(FULL_TEXT)).toBeTruthy(), {
      timeout: 5000,
    });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "typing while streaming",
    );
  });
});
