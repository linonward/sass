import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en.json";
import { PlaygroundTabs } from "./playground-tabs";

describe("PlaygroundTabs", () => {
  test("标签第一次打开时才挂载，切走后保留", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlaygroundTabs
          tabs={[
            { id: "chat", content: <p>chat panel</p> },
            { id: "video", content: <p>video panel</p> },
          ]}
        />
      </NextIntlClientProvider>,
    );
    const panel = (text: string) =>
      screen.getByText(text).closest<HTMLElement>("[role=tabpanel]")!;
    expect(panel("chat panel").hidden).toBe(false);
    expect(screen.queryByText("video panel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Video" }));
    expect(panel("video panel").hidden).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    // 切回对话后视频页仍挂载（只是隐藏），状态不丢。
    expect(panel("video panel").hidden).toBe(true);
    expect(panel("chat panel").hidden).toBe(false);
  });
});
