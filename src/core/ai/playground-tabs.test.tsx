import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { PlaygroundTabs, type PlaygroundTab } from "./playground-tabs";

// The three content components are swapped for stand-ins: these cases test the tab bar's own
// "load on demand + stay mounted" logic; the real components (useChat, GenerationsProvider) are
// covered by playground.test.tsx and e2e. vi.mock applies to the import() inside dynamic() too, so
// the stand-ins still go through the real loading path.
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
    models: [{ id: "image-model", creditCost: 2, acceptsImage: false }],
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
  test("loads a tab's content only when first opened and keeps it mounted after switching away", async () => {
    renderTabs();
    // The first tab's content waits for its own chunk (a network fetch in real life, a dynamic
    // import here).
    await screen.findByText("chat panel chat-model");
    expect(panel("chat panel chat-model").hidden).toBe(false);
    // Tabs that were never opened don't even load their content component.
    expect(screen.queryByText("image panel")).toBeNull();
    expect(screen.queryByText("video panel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Video" }));
    await screen.findByText("video panel");
    expect(panel("video panel").hidden).toBe(false);
    expect(panel("chat panel chat-model").hidden).toBe(true);
    // The middle tab still hasn't been opened.
    expect(screen.queryByText("image panel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    // After switching back to chat the video tab stays mounted (just hidden), so no state is lost.
    expect(panel("video panel").hidden).toBe(true);
    expect(panel("chat panel chat-model").hidden).toBe(false);
  });

  test("form contents in a tab survive switching away and back", async () => {
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
    // Same DOM node: hidden rather than unmounted, which is why the state survives.
    expect(back).toBe(input);
  });

  test("hides the tab bar when there is only one tab", async () => {
    renderTabs(tabs.slice(0, 1));
    expect(await screen.findByText("chat panel chat-model")).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
