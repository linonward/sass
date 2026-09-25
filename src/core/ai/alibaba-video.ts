import { APICallError } from "@ai-sdk/provider";

/** AI SDK 百炼 provider 的默认地址（国际站）。 */
const DEFAULT_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export type VideoTaskStatus =
  | { status: "pending" }
  | { status: "succeeded"; videoUrl: string }
  | { status: "failed"; error: string };

/** 异步视频任务：提交后拿到 taskId，之后按 taskId 查询状态。 */
export type VideoClient = {
  start(input: {
    model: string;
    prompt: string;
    // 图生视频的首帧，服务商能访问的地址（公开地址或签名地址）。
    firstFrameUrl?: string;
    duration: number;
    resolution: "720P" | "1080P";
    // 文生视频的画幅，例如 "16:9"；图生视频跟随首帧。
    ratio?: string;
  }): Promise<{ taskId: string }>;
  status(taskId: string): Promise<VideoTaskStatus>;
};

type TaskBody = {
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    video_url?: string;
    code?: string;
    message?: string;
  };
};

/**
 * 百炼通义万相视频（wan2.7 及以后的 `media` 协议）的原生异步接口。
 * 没有用 `@ai-sdk/alibaba` 的视频模型：它给 wan2.7-i2v 发的是 `img_url`（base64），
 * 接口要求 `media`，而且 base64 超过长度上限会被拒绝。
 */
export function createAlibabaVideoClient({
  apiKey,
  baseURL = DEFAULT_BASE_URL,
  fetch = globalThis.fetch,
}: {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}): VideoClient {
  // ALIBABA_BASE_URL 是 OpenAI 兼容地址，原生接口在同一个域名下。
  const origin = new URL(baseURL).origin;
  const auth = { Authorization: `Bearer ${apiKey}` };

  async function call(url: string, init: RequestInit, requestBody: unknown) {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: TaskBody = {};
    try {
      body = JSON.parse(text) as TaskBody;
    } catch {
      // 非 JSON 的错误页，下面按状态码报错。
    }
    if (!response.ok) {
      throw new APICallError({
        message:
          body.message ?? `Alibaba video request failed (${response.status})`,
        url,
        requestBodyValues: requestBody,
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers),
        responseBody: text,
        isRetryable: response.status === 429 || response.status >= 500,
        data: body,
      });
    }
    return body;
  }

  return {
    async start({ model, prompt, firstFrameUrl, duration, resolution, ratio }) {
      const url = `${origin}/api/v1/services/aigc/video-generation/video-synthesis`;
      const requestBody = {
        model,
        input: {
          prompt,
          ...(firstFrameUrl
            ? { media: [{ type: "first_frame", url: firstFrameUrl }] }
            : {}),
        },
        parameters: {
          resolution,
          duration,
          ...(ratio ? { ratio } : {}),
          prompt_extend: false,
          watermark: false,
        },
      };
      const body = await call(
        url,
        {
          method: "POST",
          headers: {
            ...auth,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify(requestBody),
        },
        requestBody,
      );
      const taskId = body.output?.task_id;
      if (!taskId) {
        throw new Error(`No task_id in response: ${JSON.stringify(body)}`);
      }
      return { taskId };
    },

    async status(taskId) {
      const url = `${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`;
      const { output } = await call(url, { headers: auth }, {});
      switch (output?.task_status) {
        case "PENDING":
        case "RUNNING":
          return { status: "pending" };
        case "SUCCEEDED":
          return output.video_url
            ? { status: "succeeded", videoUrl: output.video_url }
            : { status: "failed", error: "No video_url in response" };
        default:
          // FAILED、CANCELED、UNKNOWN（任务过期或不存在）。
          return {
            status: "failed",
            error:
              `${output?.task_status ?? "UNKNOWN"}: ${output?.code ?? ""} ${output?.message ?? ""}`.trim(),
          };
      }
    },
  };
}
