// @vitest-environment node
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, test, vi } from "vitest";

import { createAlibabaImageModel } from "./alibaba-image";

const IMAGE_URL = "https://dashscope-result.test/img.png";
const bytes = new Uint8Array([1, 2, 3]);

/** 第一次请求是生成接口，第二次是下载图片。 */
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
  test("调原生接口，画幅换成百炼尺寸，下载图片返回字节", async () => {
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

  test("ALIBABA_BASE_URL 是兼容模式地址，原生接口取同一个域名", async () => {
    const fetch = stubFetch(ok());
    await call(fetch, {
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  test("不支持的画幅回退到 1:1 并给出 warning", async () => {
    const fetch = stubFetch(ok());
    const result = await call(fetch, { aspectRatio: "21:9" });
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.parameters.size).toBe("1328*1328");
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: "unsupported", feature: "aspectRatio" }),
    ]);
  });

  test("接口报错抛 APICallError，429 和 5xx 可重试", async () => {
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

  test("成功响应里没有图片地址也按失败处理", async () => {
    await expect(
      call(stubFetch(Response.json({ output: { choices: [] } }))),
    ).rejects.toThrow(APICallError);
  });
});
