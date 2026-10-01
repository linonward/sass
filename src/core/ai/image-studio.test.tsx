import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { GenerationsProvider } from "./generations-context";
import type { Generation } from "./image";
import { ImageStudio } from "./image-studio";

const t = messages.Playground;

const recent: Generation = {
  id: "g1",
  kind: "image",
  fileId: "f1",
  modelId: "edit",
  prompt: "a red mug",
  url: "https://files.test/g1.png",
  mime: "image/png",
  createdAt: "2026-09-30T00:00:00.000Z",
};

const models = [
  { id: "edit", creditCost: 5, acceptsImage: true },
  { id: "plain", creditCost: 10, acceptsImage: false },
];

function renderStudio(defaultModel: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      generation: { ...recent, id: "g2", fileId: "f2", prompt: "generated" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GenerationsProvider
        initialGenerations={[recent]}
        initialPendingVideos={[]}
      >
        <ImageStudio models={models} defaultModel={defaultModel} />
      </GenerationsProvider>
    </NextIntlClientProvider>,
  );
  return fetch;
}

async function generate(fetch: ReturnType<typeof renderStudio>) {
  fireEvent.change(screen.getByPlaceholderText(t.image.placeholder), {
    target: { value: "on a marble counter" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.image.generate }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body));
  fetch.mockClear();
  return body;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImageStudio reference image", () => {
  test("models without acceptsImage show no picker and send no imageFileId", async () => {
    const fetch = renderStudio("plain");
    expect(screen.queryByText(t.image.reference)).toBeNull();
    expect(await generate(fetch)).not.toHaveProperty("imageFileId");
  });

  test("models with acceptsImage send the picked image, and nothing once it is removed", async () => {
    const fetch = renderStudio("edit");
    expect(screen.getByText(t.image.reference)).toBeTruthy();
    expect(await generate(fetch)).not.toHaveProperty("imageFileId");

    fireEvent.click(
      screen.getByRole("button", {
        name: t.picker.useImage.replace("{prompt}", recent.prompt),
      }),
    );
    expect(await generate(fetch)).toMatchObject({
      modelId: "edit",
      imageFileId: "f1",
    });

    fireEvent.click(screen.getByRole("button", { name: t.picker.remove }));
    expect(await generate(fetch)).not.toHaveProperty("imageFileId");
  });
});

describe("ImageStudio prompt templates", () => {
  test("a template fills the prompt, and Generate sends exactly that text", async () => {
    const fetch = renderStudio("plain");
    const group = screen.getByRole("group", { name: t.templates.label });
    fireEvent.click(
      within(group).getByRole("button", {
        name: t.templates.image.product.label,
      }),
    );
    const field = screen.getByPlaceholderText(t.image.placeholder);
    expect((field as HTMLTextAreaElement).value).toBe(
      t.templates.image.product.prompt,
    );
    expect(document.activeElement).toBe(field);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t.image.generate }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).prompt).toBe(
      t.templates.image.product.prompt,
    );
  });
});
