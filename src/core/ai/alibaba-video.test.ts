// @vitest-environment node
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, test, vi } from "vitest";

import { createAlibabaVideoClient } from "./alibaba-video";

function client(response: Response, baseURL?: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
  return {
    fetch,
    video: createAlibabaVideoClient({
      apiKey: "sk-x",
      baseURL,
      fetch,
    }),
  };
}

describe("start", () => {
  test("图生视频：异步提交，首帧放在 media，返回 taskId", async () => {
    const { fetch, video } = client(
      Response.json({ output: { task_id: "t1", task_status: "PENDING" } }),
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    await expect(
      video.start({
        model: "wan2.7-i2v",
        prompt: "waves",
        firstFrameUrl: "https://files.test/a.png",
        duration: 5,
        resolution: "720P",
      }),
    ).resolves.toEqual({ taskId: "t1" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    );
    const headers = new Headers(init!.headers);
    expect(headers.get("X-DashScope-Async")).toBe("enable");
    expect(headers.get("Authorization")).toBe("Bearer sk-x");
    expect(JSON.parse(String(init!.body))).toEqual({
      model: "wan2.7-i2v",
      input: {
        prompt: "waves",
        media: [{ type: "first_frame", url: "https://files.test/a.png" }],
      },
      parameters: {
        resolution: "720P",
        duration: 5,
        prompt_extend: false,
        watermark: false,
      },
    });
  });

  test("文生视频：没有 media，带 ratio；默认国际站", async () => {
    const { fetch, video } = client(
      Response.json({ output: { task_id: "t2" } }),
    );
    await video.start({
      model: "wan2.7-t2v",
      prompt: "waves",
      duration: 5,
      resolution: "1080P",
      ratio: "9:16",
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/dashscope-intl\.aliyuncs\.com\//);
    const body = JSON.parse(String(init!.body));
    expect(body.input).toEqual({ prompt: "waves" });
    expect(body.parameters).toMatchObject({
      resolution: "1080P",
      ratio: "9:16",
    });
  });

  test("接口报错抛 APICallError", async () => {
    const { video } = client(
      Response.json(
        { code: "InvalidParameter", message: "Model not exist." },
        { status: 400 },
      ),
    );
    const error = await video
      .start({ model: "x", prompt: "p", duration: 5, resolution: "720P" })
      .catch((e: unknown) => e);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({
      message: "Model not exist.",
      statusCode: 400,
      isRetryable: false,
    });
  });
});

describe("status", () => {
  test.each([
    [{ task_status: "PENDING" }, { status: "pending" }],
    [{ task_status: "RUNNING" }, { status: "pending" }],
    [
      { task_status: "SUCCEEDED", video_url: "https://v.test/a.mp4" },
      { status: "succeeded", videoUrl: "https://v.test/a.mp4" },
    ],
    [
      { task_status: "FAILED", code: "InvalidParameter", message: "bad" },
      { status: "failed", error: "FAILED: InvalidParameter bad" },
    ],
    [{ task_status: "UNKNOWN" }, { status: "failed", error: "UNKNOWN:" }],
    [
      { task_status: "SUCCEEDED" },
      { status: "failed", error: "No video_url in response" },
    ],
  ])("%j → %j", async (output, expected) => {
    const { fetch, video } = client(Response.json({ output }));
    await expect(video.status("t 1")).resolves.toEqual(expected);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/tasks/t%201",
    );
  });
});
