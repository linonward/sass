import { APICallError } from "@ai-sdk/provider";

/** Default base URL of the AI SDK Alibaba Model Studio (Bailian) provider (international site). */
const DEFAULT_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export type VideoTaskStatus =
  | { status: "pending" }
  | { status: "succeeded"; videoUrl: string }
  | { status: "failed"; error: string };

/** Async video jobs: submitting returns a taskId, which is then used to poll the status. */
export type VideoClient = {
  start(input: {
    model: string;
    prompt: string;
    // First frame for image-to-video, as a URL the provider can reach (public or signed).
    firstFrameUrl?: string;
    duration: number;
    resolution: "720P" | "1080P";
    // Aspect ratio for text-to-video, e.g. "16:9"; image-to-video follows the first frame.
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
 * Native async API for Model Studio Wan video (the `media` protocol of wan2.7 and later).
 * We don't use the `@ai-sdk/alibaba` video model: it sends `img_url` (base64) to wan2.7-i2v, but
 * the API requires `media`, and base64 over the length limit is rejected.
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
  // ALIBABA_BASE_URL is the OpenAI-compatible URL; the native endpoint lives on the same host.
  const origin = new URL(baseURL).origin;
  const auth = { Authorization: `Bearer ${apiKey}` };

  async function call(url: string, init: RequestInit, requestBody: unknown) {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: TaskBody = {};
    try {
      body = JSON.parse(text) as TaskBody;
    } catch {
      // Non-JSON error page; the error is reported by status code below.
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
          // FAILED, CANCELED, UNKNOWN (the task expired or does not exist).
          return {
            status: "failed",
            error:
              `${output?.task_status ?? "UNKNOWN"}: ${output?.code ?? ""} ${output?.message ?? ""}`.trim(),
          };
      }
    },
  };
}
