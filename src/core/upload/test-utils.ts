import { vi } from "vitest";

/**
 * Browser-side fakes for upload component tests: the three upload API calls go through a stubbed
 * `fetch`, and the progress-reporting PUT goes through FakeXhr, which the test drives by hand.
 */
export class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  method = "";
  url = "";
  body: unknown = null;
  aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send(body: unknown) {
    this.body = body;
    FakeXhr.last = this;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent);
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

type Reply = { status: number; body: unknown };

/**
 * Stubs fetch for /api/upload/presign and /api/upload/complete (and a fetch-based PUT), plus
 * XMLHttpRequest and object URLs. Returns the fetch mock so tests can count calls per path.
 */
export function stubUploadApi({
  presign = {
    status: 200,
    body: { fileId: "file_1", uploadUrl: "https://r2.test/put", headers: {} },
  },
  complete = {
    status: 200,
    body: {
      file: { id: "file_1", key: "u/2026-09/file_1.png", url: "/f/file_1" },
    },
  },
  put = { status: 200, body: null },
}: { presign?: Reply; complete?: Reply; put?: Reply } = {}) {
  const fetchMock = vi.fn(
    async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const path = String(url);
      const reply = path.endsWith("/api/upload/presign")
        ? presign
        : path.endsWith("/api/upload/complete")
          ? complete
          : put;
      return new Response(
        reply.body === null ? null : JSON.stringify(reply.body),
        { status: reply.status },
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  FakeXhr.last = null;
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  return fetchMock;
}

/** How many times fetch was called for a path such as "/api/upload/complete". */
export function calls(
  fetchMock: ReturnType<typeof stubUploadApi>,
  path: string,
) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}
