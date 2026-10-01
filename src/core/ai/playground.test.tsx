import { Profiler } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

// Regression test for streaming rendering: the server streams delta by delta, and without throttle
// useChat **re-renders on every chunk** (@ai-sdk/react/dist/index.d.ts:119-122). This uses the real
// Chat/transport path (only fetch is replaced with a real UI message stream) and counts how many
// commits the Playground subtree makes, so removing throttle gets caught.
//
// There is no wait between chunks (`_internal.delay` resolves immediately, so the whole stream is
// pushed in one microtask batch), which makes the count independent of machine load: measured at
// 64 commits without throttling and 3 with it (leading + trailing). With a real model at 30–80
// tokens/s, throttling caps re-renders at about 1000/50 = 20 per second.
const DELTA_COUNT = 60;
const FULL_TEXT = Array.from({ length: DELTA_COUNT }, (_, i) => i % 10).join(
  "",
);

function stubChatFetch(
  deltas: string[] = Array.from({ length: DELTA_COUNT }, (_, i) =>
    String(i % 10),
  ),
) {
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          _internal: { delay: async () => {} },
          chunks: [
            { type: "text-start", id: "t1" },
            ...deltas.map((delta) => ({
              type: "text-delta" as const,
              id: "t1",
              delta,
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
                // All three fields of LanguageModelV4Usage's outputTokens are required
                // (node_modules/@ai-sdk/provider/dist/index.d.ts:648). This mock only streams
                // text, so reasoning is 0, not undefined.
                outputTokens: {
                  total: deltas.length,
                  text: deltas.length,
                  reasoning: 0,
                },
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

/** Renders the real Playground and returns a counter of commits made after mount. */
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

describe("Playground streaming rendering", () => {
  test("does not re-render once per chunk over a full streamed response", async () => {
    const fetchMock = stubChatFetch();
    const commits = renderPlayground();

    typeAndSend("Hello");
    commits.length = 0;
    // Count only after the whole stream finishes (all text in + back to the sendable state), so
    // this counts commits for the entire stream.
    await waitFor(
      () => {
        expect(screen.getByText(FULL_TEXT)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Send" })).not.toBeNull();
      },
      { timeout: 5000 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 60 chunks: measured at 64 commits without throttling and 3 with it. The DELTA_COUNT / 4
    // threshold leaves plenty of margin.
    expect(
      commits.length,
      `${DELTA_COUNT} chunks caused ${commits.length} commits; throttle may have been removed`,
    ).toBeLessThan(DELTA_COUNT / 4);
  });

  test("throttling loses no content: the full text lands and input still works afterwards", async () => {
    stubChatFetch();
    renderPlayground();

    typeAndSend("Hello");
    await waitFor(() => expect(screen.getByText(FULL_TEXT)).toBeTruthy(), {
      timeout: 5000,
    });
    // Two bubbles, the user message and the assistant reply (including the role labels for screen
    // readers).
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText(/^You:/)).toBeTruthy();

    // Back to idle after the stream ends: the input still accepts typing and Send is enabled again
    // (busy is passed into the memoized Composer). Use waitFor for the button: the switch to ready
    // may commit after the last chunk of text.
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

  test("typing during streaming does not clear or interrupt the input", async () => {
    stubChatFetch();
    renderPlayground();

    typeAndSend("Hello");
    // Deliberately type before the stream ends (input state now lives inside Composer and must not
    // be reset by parent re-renders).
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

describe("Playground replies and templates", () => {
  test("renders the reply as markdown with a copy button on code blocks", async () => {
    // Split mid-fence so the stream passes through an unclosed code block.
    stubChatFetch(["Here is **bold** text.\n\n```ts\nconst a", " = 1;\n```\n"]);
    renderPlayground();

    typeAndSend("Show code");
    const bold = await screen.findByText("bold", undefined, { timeout: 5000 });
    expect(bold.tagName).not.toBe("P");
    expect(bold.textContent).toBe("bold");
    await waitFor(() => expect(screen.getByText("const a = 1;")).toBeTruthy());
    // No raw markdown syntax left in the reply.
    expect(screen.getByTestId("playground-reply").textContent).not.toMatch(
      /\*\*|```/,
    );
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  test("copy reply writes the markdown source to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubChatFetch(["Hello **there**"]);
    renderPlayground();

    typeAndSend("Hi");
    const copy = await screen.findByRole(
      "button",
      { name: "Copy reply" },
      { timeout: 5000 },
    );
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith("Hello **there**");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  test("a template fills the input without sending, and templates hide once the chat starts", async () => {
    const fetchMock = stubChatFetch(["ok"]);
    renderPlayground();

    const group = screen.getByRole("group", { name: "Prompt templates" });
    fireEvent.click(within(group).getByRole("button", { name: "Write code" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      messages.Playground.templates.chat.code.prompt,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "Prompt templates" }),
      ).toBeNull(),
    );
  });
});

describe("Playground composer keys", () => {
  test("Enter sends, Shift+Enter and IME-confirming Enter do not", async () => {
    const fetchMock = stubChatFetch(["ok"]);
    renderPlayground();
    const box = screen.getByRole("textbox");

    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((box as HTMLTextAreaElement).value).toBe("");
  });
});
