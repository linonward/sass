import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import messages from "../../../messages/en.json";
import { calls, FakeXhr, stubUploadApi } from "./test-utils";
import { UploadField } from "./upload-field";

const u = messages.Upload;
const accept = ["image/png", "image/jpeg"];

function renderField(props: Partial<Parameters<typeof UploadField>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <form data-testid="form">
        <UploadField
          name="fileId"
          accept={accept}
          maxSize={1024}
          onChange={onChange}
          {...props}
        />
      </form>
    </NextIntlClientProvider>,
  );
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const choose = (file: File) =>
    act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  return { ...view, onChange, choose };
}

const png = (size = 4) =>
  new File([new Uint8Array(size)], "photo.png", { type: "image/png" });

/** Lets the presign fetch settle so the PUT (FakeXhr) starts. */
const untilPut = () => vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadField", () => {
  test("the drop zone is a named, keyboard-reachable button with the limits as its description", () => {
    stubUploadApi();
    renderField();
    const zone = screen.getByRole("button", { name: new RegExp(u.choose) });
    expect(zone.tagName).toBe("BUTTON");
    expect(zone).toHaveProperty("tabIndex", 0);
    expect(zone.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("PNG, JPG · up to 1 KB")).toBeTruthy();
  });

  test("a disallowed type fails instantly without any request", async () => {
    const fetchMock = stubUploadApi();
    const { choose } = renderField();
    await choose(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert").textContent).toBe(u.errors.invalid_type);
    expect(fetchMock).not.toHaveBeenCalled();
    // The file itself is wrong, so there's nothing to retry.
    expect(screen.queryByRole("button", { name: u.retry })).toBeNull();
  });

  test("an oversized file fails instantly without any request", async () => {
    const fetchMock = stubUploadApi();
    const { choose } = renderField();
    await choose(png(2048));
    expect(screen.getByRole("alert").textContent).toBe(u.errors.too_large);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a server rejection shows its message; retry sends the same file again", async () => {
    const fetchMock = stubUploadApi({
      presign: { status: 503, body: { error: "upload_not_configured" } },
    });
    const { choose } = renderField();
    await choose(png(7));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        u.errors.upload_not_configured,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: u.retry }));
    });
    await vi.waitFor(() =>
      expect(calls(fetchMock, "/api/upload/presign")).toHaveLength(2),
    );
    const sizes = calls(fetchMock, "/api/upload/presign").map(
      ([, init]) => JSON.parse(String(init?.body)).size,
    );
    expect(sizes).toEqual([7, 7]);
  });

  test("cancel stops the upload and never confirms it", async () => {
    const fetchMock = stubUploadApi();
    const { choose, onChange } = renderField();
    await choose(png());
    await untilPut();
    await act(async () => {
      FakeXhr.last!.progress(2, 4);
    });
    expect(
      screen.getByRole("progressbar", {
        name: u.progress.replace("{name}", "photo.png"),
      }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: u.cancel }));
    });
    expect(FakeXhr.last!.aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(u.canceled);
    expect(calls(fetchMock, "/api/upload/complete")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a finished upload fills the hidden field and reports the file; remove clears both", async () => {
    stubUploadApi();
    const { choose, onChange } = renderField();
    await choose(png());
    await untilPut();
    await act(async () => {
      FakeXhr.last!.respond(200);
    });
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "file_1" }),
      ),
    );
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("fileId")).toBe("file_1");
    expect(screen.getByRole("link", { name: "photo.png" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: u.remove }));
    });
    expect(new FormData(form).get("fileId")).toBe("");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("dropping a file uploads it like choosing one", async () => {
    stubUploadApi();
    renderField();
    const zone = screen.getByRole("button", { name: new RegExp(u.choose) });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    });
    await untilPut();
    expect(screen.getByRole("status").textContent).toBe(
      u.uploading.replace("{name}", "photo.png"),
    );
  });
});
