import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { PlaygroundTabs, type PlaygroundTab } from "./playground-tabs";

// 三个内容组件换成替身：这一组用例测的是标签栏「按需加载 + 保留挂载」的逻辑本身，
// 真组件（useChat、GenerationsProvider）由 playground.test.tsx 和 e2e 覆盖。
// vi.mock 对 dynamic() 里的 import() 一样生效，替身仍走真实的加载路径。
vi.mock("./playground", () => ({
  Playground: ({ defaultModel }: { defaultModel: string }) => {
    const [value, setValue] = useState("");
    return (
      <>
        <p>chat panel {defaultModel}</p>
        <input
          aria-label="chat input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </>
    );
  },
}));
vi.mock("./image-studio", () => ({ ImageStudio: () => <p>image panel</p> }));
vi.mock("./video-studio", () => ({ VideoStudio: () => <p>video panel</p> }));

const tabs: PlaygroundTab[] = [
  {
    id: "chat",
    models: [{ id: "chat-model", creditCost: 1 }],
    defaultModel: "chat-model",
  },
  {
    id: "image",
    models: [{ id: "image-model", creditCost: 2 }],
    defaultModel: "image-model",
  },
  {
    id: "video",
    models: [{ id: "video-model", creditCost: 3, input: "text", duration: 5 }],
    defaultModel: "video-model",
  },
];

function renderTabs(list: PlaygroundTab[] = tabs) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PlaygroundTabs tabs={list} />
    </NextIntlClientProvider>,
  );
}

const panel = (text: string) =>
  screen.getByText(text).closest<HTMLElement>("[role=tabpanel]")!;

describe("PlaygroundTabs", () => {
  test("标签第一次打开时才加载内容，切走后保留挂载", async () => {
    renderTabs();
    // 第一个标签的内容要等它自己那个 chunk 到（真实环境里是网络，这里是一次动态 import）。
    await screen.findByText("chat panel chat-model");
    expect(panel("chat panel chat-model").hidden).toBe(false);
    // 没打开过的标签连内容组件都不加载。
    expect(screen.queryByText("image panel")).toBeNull();
    expect(screen.queryByText("video panel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Video" }));
    await screen.findByText("video panel");
    expect(panel("video panel").hidden).toBe(false);
    expect(panel("chat panel chat-model").hidden).toBe(true);
    // 中间那个标签还是没被打开过。
    expect(screen.queryByText("image panel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    // 切回对话后视频页仍挂载（只是隐藏），状态不丢。
    expect(panel("video panel").hidden).toBe(true);
    expect(panel("chat panel chat-model").hidden).toBe(false);
  });

  test("切走再切回，标签里的表单内容还在", async () => {
    renderTabs();
    const input = (await screen.findByLabelText(
      "chat input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    expect(input.value).toBe("hello");

    fireEvent.click(screen.getByRole("tab", { name: "Video" }));
    await screen.findByText("video panel");

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    const back = screen.getByLabelText("chat input") as HTMLInputElement;
    expect(back.value).toBe("hello");
    // 同一个 DOM 节点：隐藏而不是卸载，所以状态才留得住。
    expect(back).toBe(input);
  });

  test("只有一个标签时不显示标签栏", async () => {
    renderTabs(tabs.slice(0, 1));
    expect(await screen.findByText("chat panel chat-model")).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
