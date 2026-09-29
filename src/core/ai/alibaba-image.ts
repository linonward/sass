import {
  APICallError,
  type ImageModelV4,
  type SharedV4Warning,
} from "@ai-sdk/provider";

/** Default base URL of the AI SDK Alibaba Model Studio (Bailian) provider (international site). */
const DEFAULT_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Aspect ratio to Model Studio size (width*height). These are the sizes qwen-image recommends; the
// wan image models support them too.
const SIZES: Record<string, string> = {
  "1:1": "1328*1328",
  "16:9": "1664*928",
  "9:16": "928*1664",
  "4:3": "1472*1140",
  "3:4": "1140*1472",
};

type ResponseBody = {
  code?: string;
  message?: string;
  output?: {
    choices?: { message?: { content?: { image?: string }[] } }[];
  };
};

/**
 * ImageModelV4 implementation for Model Studio image models (qwen-image-*, wan*-image*).
 * `@ai-sdk/alibaba` has no image model, so this calls Model Studio's native synchronous endpoint
 * directly: POST {origin}/api/v1/services/aigc/multimodal-generation/generation.
 * The endpoint returns an image URL that is valid for 24 hours; we download it as bytes and hand
 * them to the caller to store.
 */
export function createAlibabaImageModel(
  modelId: string,
  {
    apiKey,
    baseURL = DEFAULT_BASE_URL,
    fetch = globalThis.fetch,
  }: { apiKey: string; baseURL?: string; fetch?: typeof globalThis.fetch },
): ImageModelV4 {
  // ALIBABA_BASE_URL is the OpenAI-compatible URL; the native endpoint lives on the same host.
  const url = `${new URL(baseURL).origin}/api/v1/services/aigc/multimodal-generation/generation`;

  return {
    specificationVersion: "v4",
    provider: "alibaba.image",
    modelId,
    maxImagesPerCall: 1,
    async doGenerate({
      prompt,
      size,
      aspectRatio,
      seed,
      files,
      mask,
      abortSignal,
      headers,
    }) {
      const warnings: SharedV4Warning[] = [];
      if (files?.length || mask) {
        warnings.push({
          type: "unsupported",
          feature: "files",
          details: "Image editing is not supported; input images were ignored.",
        });
      }
      let resolvedSize = size?.replace("x", "*");
      if (!resolvedSize) {
        resolvedSize = SIZES[aspectRatio ?? "1:1"];
        if (!resolvedSize) {
          warnings.push({
            type: "unsupported",
            feature: "aspectRatio",
            details: `Supported aspect ratios: ${Object.keys(SIZES).join(", ")}. Used 1:1.`,
          });
          resolvedSize = SIZES["1:1"];
        }
      }

      const requestBody = {
        model: modelId,
        input: {
          messages: [{ role: "user", content: [{ text: prompt ?? "" }] }],
        },
        parameters: {
          size: resolvedSize,
          n: 1,
          ...(seed === undefined ? {} : { seed }),
          prompt_extend: false,
          watermark: false,
        },
      };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });
      const responseHeaders = Object.fromEntries(response.headers);
      const text = await response.text();
      let body: ResponseBody = {};
      try {
        body = JSON.parse(text) as ResponseBody;
      } catch {
        // Non-JSON error page; the error is reported by status code below.
      }
      const imageUrl = body.output?.choices?.[0]?.message?.content?.find(
        (part) => part.image,
      )?.image;
      if (!response.ok || !imageUrl) {
        throw new APICallError({
          message:
            body.message ??
            `Alibaba image generation failed (${response.status})`,
          url,
          requestBodyValues: requestBody,
          statusCode: response.status,
          responseHeaders,
          responseBody: text,
          isRetryable: response.status === 429 || response.status >= 500,
          data: body,
        });
      }

      const image = await fetch(imageUrl, { signal: abortSignal });
      if (!image.ok) {
        throw new APICallError({
          message: `Failed to download the generated image (${image.status})`,
          url: imageUrl,
          requestBodyValues: {},
          statusCode: image.status,
          isRetryable: image.status >= 500,
        });
      }
      return {
        images: [new Uint8Array(await image.arrayBuffer())],
        warnings,
        response: { timestamp: new Date(), modelId, headers: responseHeaders },
      };
    },
  };
}
