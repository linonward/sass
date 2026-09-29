// @vitest-environment node
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, test, vi } from "vitest";

import { createAlibabaImageModel } from "./alibaba-image";

const IMAGE_URL = "https://dashscope-result.test/img.png";
const bytes = new Uint8Array([1, 2, 3]);

/** The first request hits the generation endpoint; the second downloads the image. */
function stubFetch(generate: Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    String(url) === IMAGE_URL || !init ? new Response(bytes) : generate,
  );
}

const ok = () =>
  Response.json({
    output: {
      choices: [{ message: { content: [{ image: IMAGE_URL }] } }],
    },
  });

function call(
  fetch: ReturnType<typeof stubFetch>,
  options: { baseURL?: string; aspectRatio?: `${number}:${number}` } = {},
) {
  const model = createAlibabaImageModel("qwen-image-3.0", {
    apiKey: "sk-x",
    baseURL: options.baseURL,
    fetch: fetch as typeof globalThis.fetch,
  });
  return Promise.resolve(
    model.doGenerate({
      prompt: "a boy",
      n: 1,
      size: undefined,
      aspectRatio: options.aspectRatio,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
    }),
  );
}

describe("createAlibabaImageModel", () => {
  test("calls the native endpoint, maps the aspect ratio to a Model Studio size, and returns the downloaded image bytes", async () => {
    const fetch = stubFetch(ok());
    const result = await call(fetch, { aspectRatio: "16:9" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    expect(new Headers(init!.headers).get("Authorization")).toBe("Bearer sk-x");
    expect(JSON.parse(String(init!.body))).toEqual({
      model: "qwen-image-3.0",
      input: { messages: [{ role: "user", content: [{ text: "a boy" }] }] },
      parameters: {
        size: "1664*928",
        n: 1,
        prompt_extend: false,
        watermark: false,
      },
    });
    expect(result.images).toEqual([bytes]);
    expect(result.warnings).toEqual([]);
  });

  test("ALIBABA_BASE_URL is the compatible-mode URL; the native endpoint uses the same host", async () => {
    const fetch = stubFetch(ok());
    await call(fetch, {
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  test("falls back to 1:1 with a warning for an unsupported aspect ratio", async () => {
    const fetch = stubFetch(ok());
    const result = await call(fetch, { aspectRatio: "21:9" });
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.parameters.size).toBe("1328*1328");
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: "unsupported", feature: "aspectRatio" }),
    ]);
  });

  test("throws APICallError on API errors; 429 and 5xx are retryable", async () => {
    const error = (status: number) =>
      call(
        stubFetch(
          Response.json(
            { code: "InvalidApiKey", message: "Invalid API-key provided." },
            { status },
          ),
        ),
      ).catch((e: unknown) => e);

    const unauthorized = await error(401);
    expect(APICallError.isInstance(unauthorized)).toBe(true);
    expect(unauthorized).toMatchObject({
      message: "Invalid API-key provided.",
      statusCode: 401,
      isRetryable: false,
    });
    expect(await error(429)).toMatchObject({ isRetryable: true });
    expect(await error(500)).toMatchObject({ isRetryable: true });
  });

  test("treats a success response without an image URL as a failure", async () => {
    await expect(
      call(stubFetch(Response.json({ output: { choices: [] } }))),
    ).rejects.toThrow(APICallError);
  });
});
