// 图片、视频接口的错误码。接口的错误响应是 JSON `{ error }`，前端按错误码显示 Playground.errors 里的文案。

const knownErrors = [
  "insufficient_credits",
  "rate_limited",
  "unavailable",
  "model_unavailable",
  "storage_unavailable",
  "invalid_model",
  "invalid_prompt",
  "invalid_aspect_ratio",
  "invalid_image",
  "unauthorized",
  "model_error",
] as const;
type KnownError = (typeof knownErrors)[number];
export type ImageErrorCode = KnownError | "generic";

/** 接口的错误响应是 JSON `{ error }`；限流返回 429（响应体不一定带 error）。 */
export async function imageErrorCode(
  response: Response,
): Promise<KnownError | "generic"> {
  if (response.status === 429) return "rate_limited";
  const code = await response
    .json()
    .then((body: { error?: unknown }) => body?.error)
    .catch(() => undefined);
  return knownErrors.includes(code as KnownError)
    ? (code as KnownError)
    : "generic";
}
