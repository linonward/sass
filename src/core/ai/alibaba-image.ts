import {
  APICallError,
  type ImageModelV4,
  type SharedV4Warning,
} from "@ai-sdk/provider";

/** AI SDK 百炼 provider 的默认地址（国际站）。 */
const DEFAULT_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// 画幅到百炼尺寸（宽*高）。取 qwen-image 推荐的几档，wan 图片模型也支持。
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
 * 百炼图片模型（qwen-image-*、wan*-image*）的 ImageModelV4 实现。
 * `@ai-sdk/alibaba` 没有图片模型，这里直接调百炼原生的同步接口：
 * POST {origin}/api/v1/services/aigc/multimodal-generation/generation。
 * 接口返回有效期 24 小时的图片地址，这里下载成字节交给调用方存储。
 */
export function createAlibabaImageModel(
  modelId: string,
  {
    apiKey,
    baseURL = DEFAULT_BASE_URL,
    fetch = globalThis.fetch,
  }: { apiKey: string; baseURL?: string; fetch?: typeof globalThis.fetch },
): ImageModelV4 {
  // ALIBABA_BASE_URL 是 OpenAI 兼容地址，原生接口在同一个域名下。
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
        // 非 JSON 的错误页，下面按状态码报错。
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
