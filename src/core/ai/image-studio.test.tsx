import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
