import { afterEach, describe, expect, test, vi } from "vitest";

import {
  isUploadAborted,
  precheckUpload,
  uploadFile,
  UploadFailedError,
} from "./client";
import { calls, FakeXhr, stubUploadApi } from "./test-utils";

const png = (size = 4) =>
  new File([new Uint8Array(size)], "photo.png", { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("precheckUpload", () => {
  const rules = { accept: ["image/png", "image/jpeg"], maxSize: 10 };

  test("accepts an allowed type within the size limit", () => {
    expect(precheckUpload({ type: "image/png", size: 10 }, rules)).toBeNull();
  });

  test("matches the server's codes for type, empty and oversized files", () => {
    expect(precheckUpload({ type: "text/plain", size: 1 }, rules)).toBe(
      "invalid_type",
    );
    expect(precheckUpload({ type: "image/png", size: 0 }, rules)).toBe(
      "invalid_size",
    );
    expect(precheckUpload({ type: "image/png", size: 11 }, rules)).toBe(
      "too_large",
    );
  });

  test("without rules only rejects empty files", () => {
    expect(precheckUpload({ type: "text/plain", size: 1 }, {})).toBeNull();
    expect(precheckUpload({ type: "text/plain", size: 0 }, {})).toBe(
      "invalid_size",
    );
  });
});

describe("uploadFile", () => {
  test("presign → PUT → complete, returning the confirmed file", async () => {
    const fetchMock = stubUploadApi();
    const file = await uploadFile(png());
    expect(file.id).toBe("file_1");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/upload/presign",
      "https://r2.test/put",
      "/api/upload/complete",
    ]);
  });

  test("a failed PUT throws put_failed and never confirms", async () => {
    const fetchMock = stubUploadApi({ put: { status: 403, body: null } });
    const error = await uploadFile(png()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadFailedError);
    expect((error as UploadFailedError).code).toBe("put_failed");
    expect(calls(fetchMock, "/api/upload/complete")).toHaveLength(0);
  });

  test("with onProgress the PUT reports progress through XMLHttpRequest", async () => {
    const fetchMock = stubUploadApi();
    const progress: number[] = [];
    const done = uploadFile(png(), { onProgress: (p) => progress.push(p) });
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    FakeXhr.last!.progress(1, 4);
    FakeXhr.last!.progress(4, 4);
    FakeXhr.last!.respond(200);
    await expect(done).resolves.toMatchObject({ id: "file_1" });
    expect(progress).toEqual([0.25, 1]);
    expect(calls(fetchMock, "/api/upload/complete")).toHaveLength(1);
  });

  test("aborting during the PUT rejects with an AbortError and never confirms", async () => {
    const fetchMock = stubUploadApi();
    const controller = new AbortController();
    const done = uploadFile(png(), {
      signal: controller.signal,
      onProgress: () => {},
    });
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    controller.abort();
    const error = await done.catch((e: unknown) => e);
    expect(isUploadAborted(error)).toBe(true);
    expect(FakeXhr.last!.aborted).toBe(true);
    expect(calls(fetchMock, "/api/upload/complete")).toHaveLength(0);
  });

  test("an already-aborted signal sends nothing", async () => {
    const fetchMock = stubUploadApi();
    const controller = new AbortController();
    controller.abort();
    const error = await uploadFile(png(), { signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(isUploadAborted(error)).toBe(true);
    expect(calls(fetchMock, "/api/upload/complete")).toHaveLength(0);
  });
});
